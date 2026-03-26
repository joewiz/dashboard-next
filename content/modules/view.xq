xquery version "3.1";

(:~
 : Template processing entry point.
 :
 : For full-page requests (layout="full"), this module:
 :   1. Processes the content template through html-templating (data-template attrs)
 :   2. Builds a layout context with dynamically discovered installed apps
 :   3. Renders the jinks-templates layout shell with the processed content inserted
 :
 : For fragment requests (layout="fragment"), only step 1 is performed,
 : returning the processed content without the page layout wrapper.
 :)

import module namespace templates="http://exist-db.org/xquery/html-templating";
import module namespace lib="http://exist-db.org/xquery/html-templating/lib";
import module namespace tmpl="http://e-editiones.org/xquery/templates";
import module namespace config="http://exist-db.org/apps/dashboard/config" at "config.xqm";
import module namespace app="http://exist-db.org/apps/dashboard" at "app.xqm";

declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";
declare namespace expath="http://expath.org/ns/pkg";

declare option output:method "html";
declare option output:html-version "5.0";
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
 : Resolver for jinks-templates: finds template files first in the app's
 : templates directory, then falls back to the site-shell package.
 :)
declare function local:resolver($relPath as xs:string) as map(*)? {
    let $local-path := $config:app-root || "/templates/" || $relPath
    let $shell-path := "/db/apps/exist-site-shell/templates/" || $relPath
    return
        if (util:binary-doc-available($local-path)) then
            map { "path": $local-path, "content": util:binary-to-string(util:binary-doc($local-path)) }
        else if (util:binary-doc-available($shell-path)) then
            map { "path": $shell-path, "content": util:binary-to-string(util:binary-doc($shell-path)) }
        else
            ()
};

(:~
 : Discover all installed eXist-db app packages.
 : Returns a map of package abbreviation to context path.
 :)
declare function local:installed-apps() as map(*) {
    let $context := request:get-context-path()
    return map:merge(
        for $pkg in repo:list()
        let $info :=
            try { repo:get-resource($pkg, "expath-pkg.xml") }
            catch * { () }
        let $parsed :=
            if (exists($info)) then
                try { parse-xml(util:binary-to-string($info)) }
                catch * { () }
            else ()
        let $abbrev := $parsed/expath:package/@abbrev/string()
        where $abbrev
        return map { $abbrev: $context || "/apps/" || $abbrev }
    )
};

(:~
 : Build the layout context for jinks-templates rendering.
 :)
declare function local:layout-context() as map(*) {
    let $apps := local:installed-apps()
    let $abbrev := "dashboard"
    let $context-path := request:get-context-path() || "/apps/" || $abbrev
    let $active-tab := request:get-attribute("active-tab")
    let $user := request:get-attribute("org.exist.login.user")
    return map {
        "title": "Dashboard",
        "context-path": $context-path,
        "apps": $apps,
        "active-tab": $active-tab,
        "user": if ($user) then $user else "guest",
        "site-logo": $context-path || "/resources/images/exist-logo.svg",
        "site-name": "eXist-db",
        "shell-base": ($apps?("exist-site-shell"), $context-path)[1],
        "nav-apps": array {
            for $app in ("dashboard", "fundocs", "eXide", "monex")
            where map:contains($apps, $app)
            return map {
                "title": switch ($app)
                    case "dashboard" return "Dashboard"
                    case "fundocs" return "Functions"
                    case "eXide" return "eXide"
                    case "monex" return "Monitoring"
                    default return $app,
                "url": $apps($app),
                "active": $app eq $abbrev
            }
        }
    }
};

(:~
 : Render the full page by wrapping processed content in the jinks layout shell.
 :)
declare function local:render-full-page($content as item()*) {
    let $ctx := local:layout-context()
    let $ctx := map:merge(($ctx, map { "content": $content }))
    let $template := local:load-resource($config:app-root || "/templates/page.html")
    return
        if ($template) then
            tmpl:process($template, $ctx, map {
                "plainText": false(),
                "resolver": local:resolver#1
            })
        else
            (: Fallback: return content without layout if template is missing :)
            $content
};

(: === Main entry point === :)

let $layout-mode := request:get-attribute("layout")
let $content := templates:apply(
    request:get-data(),
    local:lookup#2,
    (),
    $local:templating-config
)
return
    if ($layout-mode eq "full") then
        local:render-full-page($content)
    else
        $content
