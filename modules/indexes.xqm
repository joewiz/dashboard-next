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
        let $item := ($text/@qname/string(), $text/@match/string(), "(default)")[1]
        let $analyzer := $text/@analyzer/string()
        return map {
            "type": "Lucene",
            "item": $item,
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
 : Get index keys for a specific item in a collection.
 : Returns terms with frequency and document counts.
 :)
declare function idx:get-keys($collection as xs:string, $qname as xs:string,
        $index-type as xs:string, $max as xs:integer?) as map(*) {
    let $max-keys := ($max, 50)[1]
    let $data-collection := $collection
    let $callback := function($term, $data) {
        map {
            "term": string($term),
            "frequency": $data[1],
            "documents": $data[2]
        }
    }
    let $keys :=
        try {
            if ($index-type = ("Lucene", "NGram")) then
                (: Use index-keys-by-qname for Lucene/NGram :)
                let $index-name :=
                    if ($index-type eq "Lucene") then "lucene-index"
                    else "ngram-index"
                return
                    util:index-keys-by-qname(
                        xs:QName($qname), (), $callback, $max-keys, $index-name
                    )
            else if ($index-type eq "Range Field") then
                (: Range fields use a different lookup :)
                try {
                    let $range-lookup := function-lookup(xs:QName("range:index-keys-for-field"), 4)
                    return
                        if (exists($range-lookup)) then
                            $range-lookup($qname, (), $callback, $max-keys)
                        else ()
                } catch * { () }
            else
                (: Standard range indexes — query the collection :)
                let $nodes := collection($data-collection)//*[local-name() eq $qname]
                return
                    if (exists($nodes)) then
                        util:index-keys($nodes, (), $callback, $max-keys)
                    else ()
        } catch * {
            (: Index query failed — return empty :)
            ()
        }
    return map {
        "collection": $collection,
        "item": $qname,
        "type": $index-type,
        "keys": array { $keys }
    }
};

(:~ Analyze ngram indexes :)
declare %private function idx:analyze-ngram($xconf as element(cc:collection)) as map(*)* {
    for $ngram in $xconf/cc:index/cc:ngram
    return map {
        "type": "NGram",
        "item": string($ngram/@qname),
        "analyzer": "",
        "boost": "",
        "facets": array {},
        "fields": array {}
    }
};
