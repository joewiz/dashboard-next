# Index Keys: Namespace-Aware QName Resolution

## Problem

Dashboard's index browser has a "View Keys" feature that calls `util:index-keys-by-qname()` to show the indexed terms for a given QName. This works for unprefixed element names but fails silently for namespace-prefixed QNames like `db5:keyword` or `tei:persName`.

The issue is that `xs:QName("db5:keyword")` requires the `db5` prefix to be declared in the current XQuery context. The prefix-to-namespace mapping is defined in the `collection.xconf` file, not in the dashboard's XQuery module.

## Current State

In `modules/indexes.xqm`, the `idx:get-keys()` function does:

```xquery
util:index-keys-by-qname(xs:QName($qname), (), $callback, $max-keys, $index-name)
```

This fails when `$qname` is `db5:keyword` because the `db5` prefix isn't declared.

## How Monex Solves This

Monex's `indexes.xqm` (lines 1018-1046 in `~/workspace/monex/src/main/xar-resources/modules/indexes.xqm`) extracts the namespace URI from the `collection.xconf` file:

```xquery
(: Parse "tei:TEI" → extract "tei" prefix :)
(: Look up URI in .xconf: namespace-uri-for-prefix("tei", $xconf/cc:collection) :)
(: Construct dynamic XQuery: 'declare namespace tei="http://www.tei-c.org/ns/1.0"; ...' :)
(: Execute via util:eval() :)
```

The key function is `indexes:get-nodeset-from-qname()` which:

1. Splits the QName string into prefix and local-name
2. Looks up the namespace URI using `namespace-uri-for-prefix($prefix, $xconf-element)` — the `collection.xconf` root element has the namespace declarations
3. Builds a dynamic XQuery string that declares the namespace and calls `util:index-keys-by-qname()`
4. Executes via `util:eval()`

## What Needs to Change

In `modules/indexes.xqm`, the `idx:get-keys()` function needs to:

1. Accept the collection path (already does)
2. Read the `collection.xconf` from `/db/system/config/{collection}/`
3. Extract namespace declarations from the xconf root element
4. For prefixed QNames, resolve the prefix to a namespace URI
5. Either:
   - Build a dynamic XQuery with `declare namespace` and `util:eval()` (monex's approach), or
   - Use `fn:QName($namespace-uri, $local-name)` to construct the QName programmatically — this avoids `util:eval()` and is cleaner

### Option: fn:QName approach (preferred)

```xquery
let $parts := tokenize($qname, ":")
let $prefix := if (count($parts) eq 2) then $parts[1] else ""
let $local := $parts[last()]
let $xconf := collection("/db/system/config" || $collection)/cc:collection
let $ns-uri :=
    if ($prefix ne "") then
        namespace-uri-for-prefix($prefix, $xconf)
    else ""
let $resolved-qname :=
    if ($ns-uri) then QName($ns-uri, $qname)
    else QName("", $local)
return
    util:index-keys-by-qname($resolved-qname, (), $callback, $max-keys, $index-name)
```

## Reference

- Dashboard index keys: `~/workspace/dashboard-next/modules/indexes.xqm` function `idx:get-keys()`
- Monex namespace resolution: `~/workspace/monex/src/main/xar-resources/modules/indexes.xqm` lines 1018-1046
- Monex QName nodeset: `~/workspace/monex/src/main/xar-resources/modules/indexes.xqm` function `indexes:get-nodeset-from-qname()`
