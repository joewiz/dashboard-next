xquery version "3.1";

(:~
 : Direct endpoint for index key browsing.
 : Supports monex-style modes: qname, node, field.
 : Also supports start-value for prefix filtering and max for limiting results.
 :)

declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";
declare option output:method "json";
declare option output:media-type "application/json";

let $collection := request:get-parameter("collection", "")
let $item := request:get-parameter("item", "")
let $index-type := request:get-parameter("type", "")
let $show-keys-by := request:get-parameter("show-keys-by", "qname")
let $max := xs:integer((request:get-parameter("max", ()), 100)[1])
let $start-value := request:get-parameter("start-value", "")

let $element-name :=
    if (contains($item, '/')) then replace($item, '^.*/', '')
    else if (starts-with($item, '@')) then substring($item, 2)
    else $item

let $safe-name := replace($element-name, '"', '')
let $safe-collection := replace($collection, '"', '')
let $safe-start := replace($start-value, '"', '')

(: Build the start-value expression for the generated queries :)
let $start-expr := if ($safe-start != '') then '"' || $safe-start || '"' else '()'

let $start := util:system-time()

let $keys :=
    try {
        if ($show-keys-by = "node" or
            ($index-type = ("Range", "New Range") and $show-keys-by != "field")) then
            let $query :=
                'let $cb := function($term, $data) { ' ||
                '    <key term="{$term}" frequency="{$data[1]}" documents="{$data[2]}"/> ' ||
                '} ' ||
                'let $nodes := collection("' || $safe-collection || '")//*[local-name() eq "' || $safe-name || '"] ' ||
                'return if (exists($nodes)) then util:index-keys($nodes, ' || $start-expr || ', $cb, ' || $max ||
                (if ($index-type = ("Lucene", "NGram")) then
                    ', "' || (if ($index-type eq "Lucene") then "lucene-index" else "ngram-index") || '"'
                else '') ||
                ') else ()'
            return util:eval($query)

        else if ($show-keys-by = "field" and $index-type = ("Range Field", "New Range")) then
            let $query :=
                'import module namespace range="http://exist-db.org/xquery/range" at "java:org.exist.xquery.modules.range.RangeIndexModule"; ' ||
                'let $cb := function($term, $data) { ' ||
                '    <key term="{$term}" frequency="{$data[1]}" documents="{$data[2]}"/> ' ||
                '} ' ||
                'return collection("' || $safe-collection || '")/range:index-keys-for-field("' ||
                $safe-name || '", ' || $start-expr || ', $cb, ' || $max || ')'
            return try { util:eval($query) } catch * { () }

        else
            let $index-name :=
                if ($index-type eq "Lucene") then "lucene-index"
                else if ($index-type eq "NGram") then "ngram-index"
                else "range-index"
            let $query :=
                'let $cb := function($term, $data) { ' ||
                '    <key term="{$term}" frequency="{$data[1]}" documents="{$data[2]}"/> ' ||
                '} ' ||
                'return util:index-keys-by-qname(' ||
                '    QName("", "' || $safe-name || '"), ' || $start-expr || ', $cb, ' ||
                $max || ', "' || $index-name || '")'
            return util:eval-with-context($query, <parameters/>, false(),
                xmldb:xcollection($collection))

    } catch * { () }

let $elapsed := (util:system-time() - $start) div xs:dayTimeDuration("PT0.001S")

return map {
    "collection": $collection,
    "item": $item,
    "type": $index-type,
    "show-keys-by": $show-keys-by,
    "elapsed": round($elapsed) || "ms",
    "keys": array {
        for $k at $pos in $keys
        return map {
            "term": string($k/@term),
            "frequency": xs:integer($k/@frequency),
            "documents": xs:integer($k/@documents),
            "position": $pos
        }
    }
}
