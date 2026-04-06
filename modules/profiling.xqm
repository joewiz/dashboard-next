xquery version "3.1";

(:~
 : Query profiling module.
 : Wraps system:enable-tracing(), system:trace(), system:clear-trace().
 :)
module namespace prof="http://exist-db.org/apps/dashboard/profiling";

declare namespace templates="http://exist-db.org/xquery/html-templating";
declare namespace profiling="http://exist-db.org/xquery/profiling";
declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

(:~
 : Handle profiling actions: enable, disable, clear, tare.
 : Called as a REST endpoint from the controller.
 :)
declare function prof:action($action as xs:string) as map(*) {
    switch ($action)
        case "enable" return (
            system:enable-tracing(true()),
            map { "status": "enabled" }
        )
        case "disable" return (
            system:enable-tracing(false()),
            map { "status": "disabled" }
        )
        case "clear" return (
            system:clear-trace(),
            map { "status": "cleared" }
        )
        case "tare" return (
            (: Save current trace as baseline, then clear :)
            session:set-attribute("dashboard.tare", system:trace()),
            system:clear-trace(),
            map { "status": "tare-set" }
        )
        case "clear-tare" return (
            session:remove-attribute("dashboard.tare"),
            system:clear-trace(),
            map { "status": "tare-cleared" }
        )
        default return
            map { "error": "Unknown action: " || $action }
};

(:~
 : Return trace data as JSON, adjusted for tare if set.
 :)
declare function prof:get-trace() as map(*) {
    let $trace := system:trace()
    let $tare := session:get-attribute("dashboard.tare")
    let $enabled := system:tracing-enabled()
    let $queries :=
        for $q in $trace//profiling:query
        let $source := string($q/@source)
        let $calls := xs:integer($q/@calls)
        let $elapsed := xs:double($q/@elapsed)
        (: Adjust for tare :)
        let $tare-q := $tare//profiling:query[@source = $source]
        let $adj-calls := if ($tare-q) then $calls - xs:integer($tare-q/@calls) else $calls
        let $adj-elapsed := if ($tare-q) then $elapsed - xs:double($tare-q/@elapsed) else $elapsed
        where $adj-calls gt 0
        (: Filter out dashboard's own modules :)
        where not(contains($source, "/apps/dashboard/"))
        order by $adj-elapsed descending
        return map {
            "source": $source,
            "calls": $adj-calls,
            "elapsed": round($adj-elapsed * 1000) div 1000
        }
    let $functions :=
        for $f in $trace//profiling:function
        let $name := string($f/@name)
        let $source := string($f/@source)
        let $calls := xs:integer($f/@calls)
        let $elapsed := xs:double($f/@elapsed)
        let $tare-f := $tare//profiling:function[@name = $name][@source = $source]
        let $adj-calls := if ($tare-f) then $calls - xs:integer($tare-f/@calls) else $calls
        let $adj-elapsed := if ($tare-f) then $elapsed - xs:double($tare-f/@elapsed) else $elapsed
        where $adj-calls gt 0
        where not(contains($source, "/apps/dashboard/"))
        order by $adj-elapsed descending
        return map {
            "name": $name,
            "source": $source,
            "calls": $adj-calls,
            "elapsed": round($adj-elapsed * 1000) div 1000
        }
    let $indexes :=
        for $ix in $trace//profiling:index
        let $source := string($ix/@source)
        let $type := string($ix/@type)
        let $calls := xs:integer($ix/@calls)
        let $elapsed := xs:double($ix/@elapsed)
        let $opt := xs:integer(($ix/@optimization, 0)[1])
        let $tare-ix := $tare//profiling:index[@source = $source][@type = $type]
        let $adj-calls := if ($tare-ix) then $calls - xs:integer($tare-ix/@calls) else $calls
        let $adj-elapsed := if ($tare-ix) then $elapsed - xs:double($tare-ix/@elapsed) else $elapsed
        where $adj-calls gt 0
        where not(contains($source, "/apps/dashboard/"))
        order by $adj-elapsed descending
        return map {
            "source": $source,
            "type": $type,
            "calls": $adj-calls,
            "elapsed": round($adj-elapsed * 1000) div 1000,
            "optimization": $opt
        }
    return map {
        "enabled": $enabled,
        "hasTare": exists($tare),
        "queries": array { $queries },
        "functions": array { $functions },
        "indexes": array { $indexes }
    }
};
