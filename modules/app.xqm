xquery version "3.1";

(:~
 : Server-side template functions for dashboard pages.
 :
 : Home tab and monitoring use system:* and jmx:* functions directly —
 : no dependency on exist-api. Packages and Users tabs try exist-api
 : first, falling back to direct repo:* and sm:* calls.
 :)
module namespace app="http://exist-db.org/apps/dashboard";

import module namespace templates="http://exist-db.org/xquery/html-templating";

declare namespace jmx="http://exist-db.org/jmx";

import module namespace config="http://exist-db.org/apps/dashboard/config" at "config.xqm";
import module namespace exfile="http://expath.org/ns/file";

(:~
 : Inject the active tab name into the model.
 :)
declare
    %templates:wrap
function app:active-tab($node as node(), $model as map(*)) as map(*) {
    map {
        "active-tab": request:get-attribute("active-tab")
    }
};

(:~
 : Render the full System Status section for admin users.
 : Outputs stat cards directly as HTML — avoids html-templating model resolution issues.
 :)
declare function app:system-status($node as node(), $model as map(*)) as item()* {
    let $product := system:get-product-name()
    let $version := system:get-version()
    let $build := system:get-build()
    let $revision := system:get-revision()
    let $java-version := util:system-property("java.version")
    let $java-vendor := util:system-property("java.vendor")
    let $os-name := util:system-property("os.name")
    let $os-arch := util:system-property("os.arch")

    let $uptime := system:get-uptime()
    let $ms := $uptime div xs:dayTimeDuration("PT0.001S")
    let $secs := xs:integer($ms div 1000)
    let $days := $secs idiv 86400
    let $hours := ($secs mod 86400) idiv 3600
    let $mins := ($secs mod 3600) idiv 60
    let $uptime-str := string-join((
        if ($days gt 0) then $days || "d" else (),
        if ($hours gt 0) then $hours || "h" else (),
        $mins || "m"
    ), " ")

    let $free := system:get-memory-free()
    let $max := system:get-memory-max()
    let $used := $max - $free
    let $pct := if ($max gt 0) then round($used div $max * 100) else 0

    let $pkg-count := count(repo:list())

    let $jmx-token :=
        try {
            let $token-file := system:get-exist-home() || "/data/jmxservlet.token"
            return
                if (exfile:exists($token-file)) then
                    let $content := exfile:read-text($token-file)
                    (: Extract UUID token — last line, strip comments and whitespace :)
                    let $lines := tokenize($content, "\n")
                    let $token-lines :=
                        for $line in $lines
                        let $trimmed := normalize-space($line)
                        where $trimmed ne "" and not(starts-with($trimmed, "#"))
                        return $trimmed
                    let $raw := string-join($token-lines, "")
                    return replace($raw, "^token=", "")
                else ""
        } catch * { "" }

    return (
        <input xmlns="http://www.w3.org/1999/xhtml" type="hidden" id="jmx-token" value="{$jmx-token}"/>,

        <div xmlns="http://www.w3.org/1999/xhtml" class="stats-grid">
            <div class="stat-card" id="card-version">
                <h3 class="stat-label">Version</h3>
                <p class="stat-value">{$product} {$version}</p>
                <p class="stat-detail">Build {$build} &#183; {$revision}</p>
            </div>
            <div class="stat-card" id="card-java">
                <h3 class="stat-label">Java</h3>
                <p class="stat-value">{$java-version}</p>
                <p class="stat-detail">{$java-vendor}</p>
            </div>
            <div class="stat-card" id="card-os">
                <h3 class="stat-label">Platform</h3>
                <p class="stat-value">{$os-name}</p>
                <p class="stat-detail">{$os-arch}</p>
            </div>
            <div class="stat-card" id="card-uptime">
                <h3 class="stat-label">Uptime</h3>
                <p class="stat-value" id="uptime-value">{$uptime-str}</p>
                <p class="stat-detail">Since startup</p>
            </div>
        </div>,

        <div xmlns="http://www.w3.org/1999/xhtml" class="stats-grid">
            <div class="stat-card" id="card-memory">
                <h3 class="stat-label">Memory</h3>
                <div class="progress-bar-container">
                    <div class="progress-bar" id="memory-bar" style="width: {$pct}%"/>
                </div>
                <p class="stat-detail" id="memory-detail">
                    {app:format-bytes($used)} / {app:format-bytes($max)} ({$pct}%)
                </p>
            </div>
            <div class="stat-card" id="card-brokers">
                <h3 class="stat-label">Active Brokers</h3>
                <p class="stat-value" id="brokers-value">--</p>
                <p class="stat-detail" id="brokers-detail">Refreshed via JMX</p>
            </div>
            <div class="stat-card" id="card-queries">
                <h3 class="stat-label">Running Queries</h3>
                <p class="stat-value" id="queries-value">--</p>
                <p class="stat-detail" id="queries-detail">Refreshed via JMX</p>
            </div>
            <div class="stat-card" id="card-packages">
                <h3 class="stat-label">Packages</h3>
                <p class="stat-value" id="packages-value">{$pkg-count}</p>
                <p class="stat-detail">installed</p>
            </div>
        </div>
    )
};

(:~
 : Inject the JMX token as a hidden input and process children.
 : Used by both Home (via app:system-status) and Monitoring tab.
 :)
declare function app:jmx-token($node as node(), $model as map(*)) as item()* {
    let $token := app:read-jmx-token()
    return (
        <input xmlns="http://www.w3.org/1999/xhtml" type="hidden" id="jmx-token" value="{$token}"/>,
        templates:process($node/node(), $model)
    )
};

(:~ Read and parse the JMX servlet token file. :)
declare %private function app:read-jmx-token() as xs:string {
    try {
        let $token-file := system:get-exist-home() || "/data/jmxservlet.token"
        return
            if (exfile:exists($token-file)) then
                let $content := exfile:read-text($token-file)
                let $lines := tokenize($content, "\n")
                let $token-lines :=
                    for $line in $lines
                    let $trimmed := normalize-space($line)
                    where $trimmed ne "" and not(starts-with($trimmed, "#"))
                    return $trimmed
                let $raw := string-join($token-lines, "")
                return replace($raw, "^token=", "")
            else ""
    } catch * { "" }
};

(:~
 : Output a model value as text content.
 : Usage: data-template="app:value" data-template-value="$model?key"
 :)
declare function app:value($node as node(), $model as map(*), $value as xs:string?) as xs:string {
    ($value, "")[1]
};

(:~
 : Set an attribute on the current element from a model value.
 : Usage: data-template="app:attr" data-template-attr="style" data-template-value="'width: 50%'"
 :)
declare function app:attr($node as node(), $model as map(*), $attr as xs:string, $value as xs:string?) as element() {
    element { node-name($node) } {
        $node/@*[not(local-name(.) = ("data-template", "data-template-attr", "data-template-value", $attr))],
        attribute { $attr } { ($value, "")[1] },
        templates:process($node/node(), $model)
    }
};

(:~
 : Render children only if the current user is a DBA.
 : Non-admin users see nothing.
 :)
declare function app:if-admin($node as node(), $model as map(*)) as item()* {
    let $user := request:get-attribute("org.exist.login.user.user")
    return
        if (exists($user) and sm:is-dba($user)) then
            templates:process($node/node(), $model)
        else
            ()
};

(:~
 : Populate the model with installed application packages for the launcher grid.
 :)
declare
    %templates:wrap
function app:launcher($node as node(), $model as map(*)) as map(*) {
    let $context := request:get-context-path()
    let $apps :=
        for $uri in repo:list()
        let $pkg-bin :=
            try { repo:get-resource($uri, "expath-pkg.xml") } catch * { () }
        let $pkg :=
            if (exists($pkg-bin)) then
                try { parse-xml(util:binary-to-string($pkg-bin)) } catch * { () }
            else ()
        let $repo-bin :=
            try { repo:get-resource($uri, "repo.xml") } catch * { () }
        let $meta :=
            if (exists($repo-bin)) then
                try { parse-xml(util:binary-to-string($repo-bin)) } catch * { () }
            else ()
        let $abbrev := $pkg//*:package/@abbrev/string()
        let $title := ($pkg//*:package/*:title/string(), $abbrev)[1]
        let $type := string(($meta//*:type, "application")[1])
        where $type eq "application" and exists($abbrev)
        let $app-url := $context || "/apps/" || $abbrev || "/"
        (: Check for icon via repo:get-resource — same pattern as packageservice :)
        let $has-svg := try { exists(repo:get-resource($uri, "icon.svg")) } catch * { false() }
        let $has-png := try { exists(repo:get-resource($uri, "icon.png")) } catch * { false() }
        let $has-icon := $has-svg or $has-png
        let $icon-url :=
            if ($has-icon) then
                $context || "/apps/dashboard/icon?package=" || encode-for-uri($uri)
            else
                $context || "/apps/dashboard/resources/images/icon-default.svg"
        order by lower-case($title)
        return map {
            "title": $title,
            "abbrev": $abbrev,
            "url": $app-url,
            "icon": $icon-url,
            "default-icon": not($has-icon)
        }
    return map {
        "launcher-apps": $apps
    }
};

(:~
 : Render each installed app as a launcher tile.
 :)
declare function app:launcher-app($node as node(), $model as map(*)) as item()* {
    for $app in $model?launcher-apps
    let $icon-class :=
        if ($app?default-icon) then "launcher-icon default-icon"
        else "launcher-icon"
    return
        <a xmlns="http://www.w3.org/1999/xhtml" href="{$app?url}" class="launcher-tile"
           title="{$app?title}">
            <img src="{$app?icon}" alt="" class="{$icon-class}"/>
            <span class="launcher-label">{$app?title}</span>
        </a>
};

(:~ Format bytes as human-readable. :)
declare %private function app:format-bytes($bytes as xs:long) as xs:string {
    if ($bytes ge 1073741824) then
        round($bytes div 1073741824 * 10) div 10 || " GB"
    else if ($bytes ge 1048576) then
        round($bytes div 1048576 * 10) div 10 || " MB"
    else if ($bytes ge 1024) then
        round($bytes div 1024 * 10) div 10 || " KB"
    else
        $bytes || " B"
};
