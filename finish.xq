xquery version "3.1";

(:~
 : Post-install script.
 :
 : Calls the Jinks generator to copy profile files (base-page.html,
 : nav.xqm, site-config.xqm, exist-site.css) into this app.
 : Required for autodeploy compatibility.
 :)

declare variable $home external;
declare variable $dir external;
declare variable $target external;

let $config := map {
    "label": "Dashboard",
    "id": "http://exist-db.org/apps/dashboard",
    "description": "Administration dashboard for eXist-db",
    "extends": array { "exist-site" },
    "pkg": map {
        "abbrev": "dashboard",
        "version": "3.0.0-SNAPSHOT"
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

return
    if (util:binary-doc-available("/db/apps/jinks/modules/generator.xqm") or
        doc-available("/db/apps/jinks/modules/generator.xqm")) then
        try {
            let $_ := util:import-module(
                xs:anyURI("http://tei-publisher.com/library/generator"),
                "generator",
                xs:anyURI("/db/apps/jinks/modules/generator.xqm")
            )
            let $_ := util:eval('generator:process(map { "overwrite": () }, $config)', false(),
                    (xs:QName("config"), $config))
            (: Fix MIME type for .xqm modules — the generator stores them as
             : application/octet-stream but eXist needs application/xquery :)
            return
                for $mod in xmldb:get-child-resources($target || "/modules")
                where ends-with($mod, ".xqm")
                let $path := $target || "/modules/" || $mod
                where util:binary-doc-available($path) and
                      xmldb:get-mime-type(xs:anyURI($path)) != "application/xquery"
                let $content := util:binary-to-string(util:binary-doc($path))
                let $_ := xmldb:remove($target || "/modules", $mod)
                return xmldb:store($target || "/modules", $mod, $content, "application/xquery")
        } catch * {
            util:log("WARN", "dashboard: Jinks generator failed: " || $err:description)
        }
    else
        util:log("WARN", "dashboard: Jinks generator not available. Install Jinks and re-deploy.")
