xquery version "3.1";

import module namespace login="http://exist-db.org/xquery/login" at "resource:org/exist/xquery/modules/persistentlogin/login.xql";

declare namespace json="http://www.json.org";

declare variable $exist:prefix external;
declare variable $exist:controller external;
declare variable $exist:path external;
declare variable $exist:resource external;

declare variable $local:method := lower-case(request:get-method());
declare variable $local:is-get := $local:method eq 'get';
declare variable $local:user := login:set-user("org.exist.login", (), false());

(:~ Tab routes: path segment mapped to page template name :)
declare variable $local:tabs := map {
    "":           "home",
    "packages":   "packages",
    "users":      "users",
    "monitoring": "monitoring",
    "profiling":  "profiling",
    "console":    "console",
    "indexes":    "indexes",
    "system":     "system"
};

(:~
 : Render a page through the view pipeline.
 : Forwards the content page to view.xq for html-templating + jinks processing.
 :)
declare function local:render-page($page as xs:string, $tab as xs:string) {
    let $user := request:get-attribute("org.exist.login.user")
    return
        if (empty($user) or not(sm:is-dba($user))) then
            <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
                <forward url="templates/pages/login.html"/>
                <view>
                    <forward url="{$exist:controller}/modules/view.xq">
                        <set-attribute name="layout" value="full"/>
                        <set-attribute name="active-tab" value=""/>
                    </forward>
                </view>
            </dispatch>
        else
            <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
                <forward url="templates/pages/{$page}.html"/>
                <view>
                    <forward url="{$exist:controller}/modules/view.xq">
                        <set-attribute name="layout" value="full"/>
                        <set-attribute name="active-tab" value="{$tab}"/>
                    </forward>
                </view>
            </dispatch>
};

(: === Request dispatch === :)

if ($local:is-get and $exist:path eq '') then (
    <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
        <redirect url="{concat(request:get-uri(), '/')}"/>
    </dispatch>

) else if ($local:is-get and $exist:path eq '/') then (
    local:render-page('home', 'home')

) else if ($local:is-get and map:contains($local:tabs, substring($exist:path, 2))) then (
    let $tab := substring($exist:path, 2)
    return local:render-page($local:tabs($tab), $tab)

) else if ($local:is-get and $exist:path eq '/login') then (
    try {
        util:declare-option("exist:serialize", "method=json"),
        <status>
            <user>{request:get-attribute("org.exist.login.user")}</user>
            <isAdmin json:literal="true">{ sm:is-dba(request:get-attribute("org.exist.login.user")) }</isAdmin>
        </status>
    } catch * {
        response:set-status-code(401),
        <status>{$err:description}</status>
    }

) else if ($local:method eq 'post' and $exist:path eq '/login') then (
    try {
        util:declare-option("exist:serialize", "method=json"),
        let $user := request:get-attribute("org.exist.login.user")
        return
            if ($user) then
                <status>
                    <user>{$user}</user>
                    <isAdmin json:literal="true">{ sm:is-dba($user) }</isAdmin>
                </status>
            else (
                response:set-status-code(401),
                <status>Login failed</status>
            )
    } catch * {
        response:set-status-code(401),
        <status>{$err:description}</status>
    }

) else if ($local:is-get and matches($exist:path, "/resources/(css|js|images|fonts)/.+")) then (
    <dispatch xmlns="http://exist.sourceforge.net/NS/exist">
        <forward url="{$exist:controller}{$exist:path}">
            <set-header name="Cache-Control" value="max-age=3600, must-revalidate"/>
        </forward>
    </dispatch>

) else (
    response:set-status-code(404),
    <data>Not Found</data>
)
