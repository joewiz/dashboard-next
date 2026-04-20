xquery version "3.1";

import module namespace login="http://exist-db.org/xquery/login" at "resource:org/exist/xquery/modules/persistentlogin/login.xql";

declare namespace json="http://www.json.org";

declare variable $exist:prefix external;
declare variable $exist:controller external;
declare variable $exist:path external;
declare variable $exist:resource external;

declare variable $local:method := lower-case(request:get-method());
declare variable $local:is-get := $local:method eq 'get';
(: Read the roaster-compatible cookie to authenticate the current request :)
declare variable $local:user := login:set-user("org.exist.login.user", (), false());

(:~ Check if the current user is a DBA :)
declare function local:is-dba() as xs:boolean {
    let $user := request:get-attribute("org.exist.login.user.user")
    return exists($user) and sm:is-dba($user)
};

(:~ Forward to api.xq with an action attribute. DBA-only. :)
declare function local:api($action as xs:string) {
    if (not(local:is-dba())) then (
        response:set-status-code(403),
        <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
            <forward url="{$exist:controller}/modules/api.xq">
                <set-attribute name="api-action" value="forbidden"/>
            </forward>
        </dispatch>
    ) else
        <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
            <forward url="{$exist:controller}/modules/api.xq">
                <set-attribute name="api-action" value="{$action}"/>
            </forward>
        </dispatch>
};

(:~ Tab routes: path segment mapped to page template name :)
declare variable $local:tabs := map {
    "":            "home",
    "collections": "collections",
    "packages":    "packages",
    "users":       "users",
    "monitoring":  "monitoring",
    "profiling":   "profiling",
    "console":     "console",
    "indexes":     "indexes",
    "system":      "system"
};

(:~ Tabs accessible without login :)
declare variable $local:public-tabs := ("", "home", "collections");

(:~
 : Render a page through the view pipeline.
 : Public tabs (Home) are visible to all users.
 : Admin tabs require DBA login.
 :)
declare function local:render-page($page as xs:string, $tab as xs:string) {
    let $user := request:get-attribute("org.exist.login.user.user")
    let $is-admin := exists($user) and sm:is-dba($user)
    let $is-public := $tab = $local:public-tabs
    return
        if ($is-public or $is-admin) then
            <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
                <forward url="{$exist:controller}/modules/view.xq">
                    <set-attribute name="template" value="templates/pages/{$page}.html"/>
                    <set-attribute name="active-tab" value="{$tab}"/>
                </forward>
            </dispatch>
        else
            <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
                <forward url="{$exist:controller}/modules/view.xq">
                    <set-attribute name="template" value="templates/pages/login.html"/>
                    <set-attribute name="active-tab" value=""/>
                </forward>
            </dispatch>
};

(: ============================================================ :)
(: Request dispatch                                              :)
(: ============================================================ :)

(: --- Redirects --- :)

if ($local:is-get and $exist:path eq '') then (
    <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
        <redirect url="{concat(request:get-uri(), '/')}"/>
    </dispatch>

(: --- Tab pages (GET) --- :)

) else if ($local:is-get and $exist:path eq '/') then (
    local:render-page('home', 'home')

) else if ($local:is-get and map:contains($local:tabs, substring($exist:path, 2))) then (
    let $tab := substring($exist:path, 2)
    return local:render-page($local:tabs($tab), $tab)

(: --- Login/Logout — handled by Roaster for cookie compatibility with exist-api --- :)

) else if ($exist:path = ('/login', '/logout')) then (
    <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
        <forward url="{$exist:controller}/modules/login-api.xq"/>
    </dispatch>

(: --- Icon endpoint (public, like packageservice get-icon.xql) --- :)

) else if ($local:is-get and $exist:path eq '/icon') then (
    let $pkg := request:get-parameter("package", ())
    return
        if (empty($pkg)) then (
            response:set-status-code(400),
            <error>Missing package parameter</error>
        ) else
            let $svg := try { repo:get-resource($pkg, "icon.svg") } catch * { () }
            return
                if (exists($svg)) then
                    response:stream-binary($svg, "image/svg+xml", ())
                else
                    let $png := try { repo:get-resource($pkg, "icon.png") } catch * { () }
                    return
                        if (exists($png)) then
                            response:stream-binary($png, "image/png", ())
                        else (
                            response:set-status-code(404),
                            <error>No icon found</error>
                        )

(: --- Profiling API --- :)

) else if ($local:method eq 'post' and $exist:path eq '/profiling/action') then (
    local:api("profiling-action")
) else if ($local:is-get and $exist:path eq '/profiling/data') then (
    local:api("profiling-data")

(: --- Packages API --- :)

) else if ($local:is-get and $exist:path eq '/packages/data') then (
    local:api("packages-data")
) else if ($local:is-get and $exist:path eq '/packages/available') then (
    local:api("packages-available")
) else if ($local:method eq 'post' and $exist:path eq '/packages/action') then (
    local:api("packages-action")

(: --- Users API --- :)

) else if ($local:is-get and $exist:path eq '/users/data') then (
    local:api("users-data")
) else if ($local:is-get and $exist:path eq '/users/groups-data') then (
    local:api("groups-data")
) else if ($local:method eq 'post' and $exist:path eq '/users/action') then (
    local:api("users-action")

(: --- Indexes API --- :)

) else if ($local:is-get and $exist:path eq '/indexes/collections') then (
    local:api("indexes-collections")
) else if ($local:is-get and $exist:path eq '/indexes/data') then (
    local:api("indexes-data")
) else if ($local:is-get and $exist:path eq '/indexes/keys') then (
    local:api("indexes-keys")

(: --- System API --- :)

) else if ($local:is-get and $exist:path eq '/system/data') then (
    local:api("system-data")

(: --- Static resources --- :)

) else if ($local:is-get and matches($exist:path, "/resources/(css|js|images|fonts)/.+")) then (
    <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
        <forward url="{$exist:controller}{$exist:path}">
            <set-header name="Cache-Control" value="max-age=3600, must-revalidate"/>
        </forward>
    </dispatch>

(: --- 404 --- :)

) else (
    response:set-status-code(404),
    <data>Not Found</data>
)
