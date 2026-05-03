xquery version "3.1";

(:~
 : Package management module.
 : Provides list/install/remove via direct repo:* calls.
 : Used as fallback when exist-api is not available, and for server-side rendering.
 :)
module namespace pkgs="http://exist-db.org/apps/dashboard/packages";

import module namespace hc="http://expath.org/ns/http-client";

declare namespace templates="http://exist-db.org/xquery/html-templating";
declare namespace expath="http://expath.org/ns/pkg";
declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

(:~
 : List all installed packages as JSON.
 :)
declare function pkgs:list() as map(*) {
    let $packages :=
        for $uri in repo:list()
        let $info :=
            try { repo:get-resource($uri, "expath-pkg.xml") } catch * { () }
        let $parsed :=
            if (exists($info)) then
                try { parse-xml(util:binary-to-string($info)) } catch * { () }
            else ()
        let $repo-meta :=
            try { repo:get-resource($uri, "repo.xml") } catch * { () }
        let $meta :=
            if (exists($repo-meta)) then
                try { parse-xml(util:binary-to-string($repo-meta)) } catch * { () }
            else ()
        let $abbrev := $parsed/expath:package/@abbrev/string()
        let $title := ($parsed/expath:package/expath:title/string(), $abbrev)[1]
        let $version := $parsed/expath:package/@version/string()
        let $website := string(($meta//*:website, "")[1])
        let $license := string(($meta//*:license, "")[1])
        let $author := string(($meta//*:author[1], "")[1])
        let $changelog := array {
            for $change in $meta//*:changelog/*:change
            return map {
                "version": string($change/@version),
                "items": array {
                    for $li in $change//*:li
                    return normalize-space($li)
                }
            }
        }
        order by lower-case($title)
        return map {
            "name": $uri,
            "abbrev": ($abbrev, "")[1],
            "title": $title,
            "version": ($version, "")[1],
            "description": string(($meta//*:description, "")[1]),
            "type": string(($meta//*:type, "application")[1]),
            "website": $website,
            "license": $license,
            "author": $author,
            "changelog": $changelog
        }
    return map {
        "packages": array { $packages }
    }
};

(:~
 : Query the public repository for available packages.
 : Compares with installed packages to flag updates.
 :)
declare function pkgs:available() as map(*) {
    let $repo-url := "https://exist-db.org/exist/apps/public-repo/public/apps.xml"
    let $version := system:get-version()
    let $installed := map:merge(
        for $uri in repo:list()
        let $info := try { repo:get-resource($uri, "expath-pkg.xml") } catch * { () }
        let $parsed := if (exists($info)) then try { parse-xml(util:binary-to-string($info)) } catch * { () } else ()
        let $abbrev := $parsed/expath:package/@abbrev/string()
        let $ver := $parsed/expath:package/@version/string()
        where $abbrev
        return map { $abbrev: $ver }
    )
    let $apps :=
        try {
            let $qs := string-join(("version=" || encode-for-uri($version), "source=dashboard"), codepoints-to-string(38))
            let $response := doc($repo-url || "?" || $qs)
            for $app in $response//app
            let $abbrev := string(($app/abbrev, "")[1])
            let $name := string(($app/name, "")[1])
            let $title := string(($app/title, $abbrev)[1])
            let $app-version := string(($app/version, "")[1])
            let $installed-version := $installed($abbrev)
            order by lower-case($title)
            return map {
                "name": $name,
                "abbrev": $abbrev,
                "title": $title,
                "version": $app-version,
                "description": string(($app/description, "")[1]),
                "type": string(($app/type, "application")[1]),
                "installed": ($installed-version, "")[1],
                "update-available":
                    if ($installed-version and $installed-version ne $app-version) then true()
                    else false()
            }
        } catch * {
            (: Public repo unavailable — return empty sequence :)
            ()
        }
    return map {
        "available": array { $apps }
    }
};

(:~
 : Install a package.
 : Accepts: a /db path to a stored .xar, an http(s) URL pointing at a .xar
 : download, or a package name (URI) resolvable through the public repo.
 :)
declare function pkgs:install($url as xs:string) as map(*) {
    try {
        let $result :=
            if (starts-with($url, "/db")) then
                repo:install-and-deploy-from-db($url)
            else if (matches($url, "^https?://.+\.xar(\?.*)?$", "i")) then
                let $stored := pkgs:download-to-repo($url)
                return repo:install-and-deploy-from-db($stored)
            else
                repo:install-and-deploy($url, "http://exist-db.org/exist/apps/public-repo/modules/find.xql")
        return map { "status": "installed", "result": string($result) }
    } catch * {
        map { "error": $err:description }
    }
};

(:~
 : Download a .xar from an http(s) URL into /db/system/repo and return the
 : stored path. Filename is derived from the URL (path segment, query stripped).
 :)
declare %private function pkgs:download-to-repo($url as xs:string) as xs:string {
    let $filename := tokenize(replace($url, "\?.*$", ""), "/")[last()]
    let $response := hc:send-request(<hc:request method="GET" href="{$url}"/>)
    let $status := xs:integer($response[1]/@status)
    return
        if ($status ne 200) then
            error(xs:QName("pkgs:download-failed"),
                "Download failed (HTTP " || $status || ") for " || $url)
        else
            xmldb:store("/db/system/repo", $filename, $response[2], "application/octet-stream")
};

(:~
 : Store an uploaded .xar binary to /db/system/repo and install it.
 : Expects the request body to contain the .xar bytes.
 :)
declare function pkgs:upload($filename as xs:string) as map(*) {
    if ($filename eq "" or matches($filename, "[/\\]") or not(ends-with(lower-case($filename), ".xar"))) then
        map { "error": "Invalid filename; must be a .xar with no path separators" }
    else
        try {
            let $data := request:get-data()
            return
                if (empty($data)) then
                    map { "error": "Empty request body" }
                else
                    let $stored := xmldb:store("/db/system/repo", $filename, $data, "application/octet-stream")
                    return pkgs:install("/db/system/repo/" || $filename)
        } catch * {
            map { "error": $err:description }
        }
};

(:~
 : Remove a package by URI.
 :)
declare function pkgs:remove($uri as xs:string) as map(*) {
    try {
        let $result := repo:undeploy($uri)
        let $_ := repo:remove($uri)
        return map { "status": "removed" }
    } catch * {
        map { "error": $err:description }
    }
};
