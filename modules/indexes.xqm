xquery version "3.1";

(:~
 : Index browser module.
 : Reads collection.xconf files from /db/system/config/ to display
 : Lucene, range, and ngram index configurations.
 :)
module namespace idx="http://exist-db.org/apps/dashboard/indexes";

declare namespace cc="http://exist-db.org/collection-config/1.0";

(:~
 : List all collections that have index configurations.
 :)
declare function idx:list-configured-collections() as map(*) {
    let $xconfs := collection("/db/system/config")/cc:collection[cc:index]
    let $collections :=
        for $xconf in $xconfs
        let $path := util:collection-name($xconf)
        (: Strip /db/system/config prefix to get the actual collection path :)
        let $target := replace($path, "^/db/system/config", "")
        let $target := if ($target eq "") then "/" else $target
        let $has-lucene := exists($xconf/cc:index/cc:lucene)
        let $has-range := exists($xconf/cc:index/cc:create) or exists($xconf/cc:index/cc:range)
        let $has-ngram := exists($xconf/cc:index/cc:ngram)
        order by $target
        return map {
            "collection": $target,
            "config-path": $path,
            "lucene": $has-lucene,
            "range": $has-range,
            "ngram": $has-ngram
        }
    return map {
        "collections": array { $collections }
    }
};

(:~
 : Get detailed index configuration for a specific collection.
 :)
declare function idx:get-indexes($collection as xs:string) as map(*) {
    let $config-path := "/db/system/config" || $collection
    let $xconf := collection($config-path)/cc:collection[cc:index]
    return
        if (empty($xconf)) then
            map { "collection": $collection, "indexes": array {} }
        else
            let $indexes := (
                idx:analyze-lucene($xconf),
                idx:analyze-range($xconf),
                idx:analyze-new-range($xconf),
                idx:analyze-ngram($xconf)
            )
            return map {
                "collection": $collection,
                "indexes": array { $indexes }
            }
};

(:~ Analyze Lucene indexes :)
declare %private function idx:analyze-lucene($xconf as element(cc:collection)) as map(*)* {
    let $lucene := $xconf/cc:index/cc:lucene
    return (
        for $text in $lucene//cc:text
        let $qname := $text/@qname/string()
        let $match := $text/@match/string()
        let $item := ($qname, $match, "(default)")[1]
        let $analyzer := $text/@analyzer/string()
        return map {
            "type": "Lucene",
            "item": $item,
            "has-qname": exists($qname),
            "analyzer": ($analyzer, "default")[1],
            "boost": string(($text/@boost, "")[1]),
            "facets": array {
                for $f in $text/cc:facet
                return map {
                    "dimension": string($f/@dimension),
                    "expression": string($f/@expression),
                    "hierarchical": string(($f/@hierarchical, "no")[1])
                }
            },
            "fields": array {
                for $f in $text/cc:field
                return map {
                    "name": string($f/@name),
                    "expression": string(($f/@expression, $f/@match, "")[1]),
                    "type": string(($f/@type, "xs:string")[1]),
                    "store": string(($f/@store, "yes")[1])
                }
            }
        },
        for $text in $lucene//cc:text
        for $inline in $text/(cc:inline | cc:ignore)
        return map {
            "type": "Lucene " || local-name($inline),
            "item": string($inline/@qname),
            "analyzer": "",
            "boost": "",
            "facets": array {},
            "fields": array {}
        }
    )
};

(:~ Analyze old-style range indexes :)
declare %private function idx:analyze-range($xconf as element(cc:collection)) as map(*)* {
    for $range in $xconf/cc:index/cc:create
    let $item := ($range/@qname/string(), $range/@path/string())[1]
    let $type := $range/@type/string()
    return map {
        "type": "Range",
        "item": ($item, "(unknown)")[1],
        "analyzer": ($type, "")[1],
        "boost": "",
        "facets": array {},
        "fields": array {}
    }
};

(:~ Analyze new-style range indexes :)
declare %private function idx:analyze-new-range($xconf as element(cc:collection)) as map(*)* {
    (
        (: Range indexes without fields :)
        for $create in $xconf/cc:index/cc:range/cc:create[not(cc:field)]
        let $item := ($create/@qname/string(), $create/@match/string())[1]
        let $type := $create/@type/string()
        return map {
            "type": "New Range",
            "item": ($item, "(unknown)")[1],
            "analyzer": ($type, "")[1],
            "boost": "",
            "facets": array {},
            "fields": array {}
        },
        (: Range index fields :)
        for $field in $xconf/cc:index/cc:range/cc:create/cc:field
        return map {
            "type": "Range Field",
            "item": string($field/@name),
            "analyzer": string(($field/@type, "xs:string")[1]),
            "boost": string(($field/@match, "")[1]),
            "facets": array {},
            "fields": array {}
        }
    )
};

(:~
 : Resolve a QName string (possibly prefixed like "db5:keyword") to a proper
 : xs:QName using namespace declarations from the collection's index config.
 :)
declare %private function idx:resolve-qname($qname-str as xs:string, $collection as xs:string) as xs:QName {
    if (not(contains($qname-str, ':'))) then
        QName("", $qname-str)
    else
        (: Look up the namespace from the collection.xconf :)
        let $prefix := substring-before($qname-str, ':')
        let $local := substring-after($qname-str, ':')
        let $conf-path := "/db/system/config" || $collection
        let $conf := collection($conf-path)//cc:collection
        (: Get namespace from the conf document's in-scope namespaces :)
        let $ns := namespace-uri-for-prefix($prefix, $conf)
        return
            if ($ns) then QName($ns, $qname-str)
            else
                (: Fallback: try to find a node with this prefix in the data :)
                let $sample := (collection($collection)//*[local-name() eq $local])[1]
                return
                    if (exists($sample)) then node-name($sample)
                    else QName("", $local)
};

(:~
 : Get a nodeset from a collection by QName, for use with util:index-keys.
 : Mirrors monex's indexes:get-nodeset-from-qname().
 :)
declare %private function idx:get-nodeset($collection as xs:string, $qname-str as xs:string) as node()* {
    let $is-attr := starts-with($qname-str, '@')
    let $clean := if ($is-attr) then substring($qname-str, 2) else $qname-str
    return
        if ($is-attr) then
            collection($collection)//@*[local-name() eq (if (contains($clean, ':')) then substring-after($clean, ':') else $clean)]
        else
            collection($collection)//*[local-name() eq (if (contains($clean, ':')) then substring-after($clean, ':') else $clean)]
};

(:~
 : Get index keys for a specific item in a collection.
 : Returns terms with frequency and document counts.
 :)
declare function idx:get-keys($collection as xs:string, $qname as xs:string,
        $index-type as xs:string, $max as xs:integer?) as map(*) {
    let $max-keys := ($max, 50)[1]
    (: Use element-based callback to avoid issues with maps in forwarded contexts :)
    let $callback := function($term, $data) {
        <key term="{$term}" frequency="{$data[1]}" documents="{$data[2]}"/>
    }
    (: For Lucene/NGram, the item might be a path like /topic/title or //section/title
       — extract just the element name for QName-based lookup :)
    let $element-name :=
        if (contains($qname, '/')) then
            replace($qname, '^.*/', '')
        else if (starts-with($qname, '@')) then
            substring($qname, 2)
        else
            $qname
    (: Use util:eval to run the index lookup in a fresh context —
       forwarded XQuery requests don't always have the right context
       for util:index-keys-by-qname to find results :)
    let $keys :=
        try {
            if ($index-type = ("Lucene", "NGram")) then
                let $index-name :=
                    if ($index-type eq "Lucene") then "lucene-index"
                    else "ngram-index"
                let $query := ``[
                    let $cb := function($term, $data) {
                        <key term="{$term}" frequency="{$data[1]}" documents="{$data[2]}"/>
                    }
                    return util:index-keys-by-qname(
                        QName("", "`{$element-name}`"), (), $cb, `{$max-keys}`, "`{$index-name}`"
                    )
                ]``
                return util:eval($query)
            else if ($index-type eq "Range Field") then
                try {
                    let $range-lookup := (
                        function-lookup(xs:QName("range:index-keys-for-field"), 4),
                        function-lookup(xs:QName("range:index-keys-for-field"), 3)
                    )[1]
                    return
                        if (exists($range-lookup)) then
                            if (function-arity($range-lookup) = 4) then
                                collection($collection)/$range-lookup($qname, (), $callback, $max-keys)
                            else
                                collection($collection)/$range-lookup($qname, $callback, $max-keys)
                        else ()
                } catch * { () }
            else
                (: Standard range indexes :)
                let $nodes := idx:get-nodeset($collection, $qname)
                return
                    if (exists($nodes)) then
                        let $query := ``[
                            let $nodes := collection("`{$collection}`")//*[local-name() eq "`{$element-name}`"]
                            let $cb := function($term, $data) {
                                <key term="{$term}" frequency="{$data[1]}" documents="{$data[2]}"/>
                            }
                            return util:index-keys($nodes, (), $cb, `{$max-keys}`)
                        ]``
                        return util:eval($query)
                    else ()
        } catch * {
            ()
        }
    return map {
        "collection": $collection,
        "item": $qname,
        "type": $index-type,
        "keys": array {
            for $k in $keys
            return map {
                "term": string($k/@term),
                "frequency": xs:integer($k/@frequency),
                "documents": xs:integer($k/@documents)
            }
        }
    }
};

(:~ Analyze ngram indexes :)
declare %private function idx:analyze-ngram($xconf as element(cc:collection)) as map(*)* {
    for $ngram in $xconf/cc:index/cc:ngram
    return map {
        "type": "NGram",
        "item": string($ngram/@qname),
        "has-qname": true(),
        "analyzer": "",
        "boost": "",
        "facets": array {},
        "fields": array {}
    }
};
