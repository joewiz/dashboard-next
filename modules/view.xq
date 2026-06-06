xquery version "3.1";

(:~
 : Template view module.
 :
 : Pass 1: Render page-specific templates via html-templating (data-template attrs)
 : Pass 2: Render page-content.tpl via Jinks (extends profile's base-page.html)
 :
 : base-page.html, nav.xqm, and site-config.xqm are provided by the exist-site
 : profile and are resolved at runtime from the installed exist-site-shell
 : ($config:shell-root) — not copied into this app. exist-site-shell is a
 : package dependency, so the shared shell is the single source of truth and
 : nothing needs regenerating after a deploy.
 :)

import module namespace templates="http://exist-db.org/xquery/html-templating";
import module namespace tmpl="http://e-editiones.org/xquery/templates";
import module namespace config="http://exist-db.org/apps/dashboard/config" at "config.xqm";
import module namespace app="http://exist-db.org/apps/dashboard" at "app.xqm";

declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

declare option output:method "html5";
declare option output:media-type "text/html";
declare option output:indent "no";

(:~ Function lookup for html-templating dispatch :)
declare function local:lookup($func as xs:string, $arity as xs:integer) as function(*)? {
    function-lookup(xs:QName($func), $arity)
};

(:~ html-templating configuration :)
declare variable $local:templating-config := map {
    $templates:CONFIG_APP_ROOT : $config:app-root,
    $templates:CONFIG_USE_CLASS_SYNTAX : false(),
    $templates:CONFIG_FILTER_ATTRIBUTES : true(),
    $templates:CONFIG_STOP_ON_ERROR : true()
};

(:~
 : Load a resource as a string, whether stored as binary or XML.
 :)
declare function local:load-resource($path as xs:string) as xs:string? {
    if (util:binary-doc-available($path)) then
        util:binary-to-string(util:binary-doc($path))
    else if (doc-available($path)) then
        serialize(doc($path))
    else
        ()
};

(:~
 : Load a Jinks template from a single absolute collection path.
 :)
declare function local:resolve-at($effectivePath as xs:string) as map(*)? {
    let $content := local:load-resource($effectivePath)
    return
        if ($content) then
            map { "path": $effectivePath, "content": $content }
        else
            ()
};

(:~
 : Resolver for Jinks templates.
 : Absolute /db/ paths are used as-is. Relative paths resolve against the app
 : root first, then fall back to the shared exist-site-shell — base-page.html
 : and the other exist-site profile files live there and are no longer copied
 : into this app (see $config:shell-root).
 :)
declare function local:resolver($path as xs:string) as map(*)? {
    if (starts-with($path, "/db/")) then
        local:resolve-at($path)
    else
        (
            local:resolve-at($config:app-root || "/" || $path),
            local:resolve-at($config:shell-root || "/" || $path)
        )[1]
};

(:~
 : Build the rendering context (matches exist-site profile's base-page.html interface).
 :)
declare function local:context() as map(*) {
    let $contextPath := request:get-context-path() || "/apps/dashboard"
    let $activeTab := request:get-attribute("active-tab")
    let $tabs := map:merge(
        for $tab in ("home", "collections", "packages", "users", "monitoring", "profiling", "console", "indexes", "system")
        return map { $tab: if ($tab eq $activeTab) then "active" else "" }
    )
    return map {
        "context-path": $contextPath,
        "active-tab": $activeTab,
        "tabs": $tabs,
        "styles": array { "resources/css/exist-site.css", "resources/css/dashboard.css" },
        "site": map {
            "name": "eXist-db",
            "logo": "resources/images/exist-logo.svg"
        },
        "nav": map {
            "items": array {
                map { "abbrev": "dashboard", "title": "Dashboard" },
                map { "abbrev": "docs", "title": "Documentation" },
                map { "abbrev": "notebook", "title": "Notebook" },
                map { "abbrev": "blog", "title": "Blog" }
            }
        }
    }
};

(:~
 : Render a full page.
 : Pass 1: html-templating processes data-template attributes
 : Pass 2: Jinks renders page-content.tpl (extends base-page.html)
 :)
declare function local:render-full-page($htmlContent as item()*) {
    let $ctx := local:context()
    let $tpl := local:load-resource($config:app-root || "/templates/page-content.tpl")
    let $fullCtx := map:merge((
        $ctx,
        map { "tab-content": $htmlContent }
    ))
    return
        if ($tpl) then
            tmpl:process($tpl, $fullCtx, map {
                "plainText": false(),
                "resolver": local:resolver#1,
                "modules": map {
                    "http://exist-db.org/site/nav": map {
                        "prefix": "nav",
                        "at": $config:shell-root || "/modules/nav.xqm"
                    },
                    "http://exist-db.org/site/shell-config": map {
                        "prefix": "site-config",
                        "at": $config:shell-root || "/modules/site-config.xqm"
                    }
                }
            })
        else
            $htmlContent
};

(: === Main entry point === :)

let $templatePath := request:get-attribute("template")
let $fullPath := $config:app-root || "/" || $templatePath

(: Load the content template from the database :)
let $doc :=
    if (doc-available($fullPath)) then
        doc($fullPath)
    else if (util:binary-doc-available($fullPath)) then
        parse-xml(util:binary-to-string(util:binary-doc($fullPath)))
    else
        <div>Template not found: {$templatePath}</div>

(: Pass 1: Process data-template attributes via html-templating :)
let $content := templates:apply(
    $doc,
    local:lookup#2,
    (),
    $local:templating-config
)

(: Pass 2: Wrap in dashboard layout (extends base-page.html) :)
return local:render-full-page($content)
