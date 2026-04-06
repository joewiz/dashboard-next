xquery version "3.1";

(:~
 : Login/logout API using Roaster.
 : Sets cookies compatible with exist-api's roaster-based auth.
 : Cookie name: org.exist.login.user (matches exist-api's cookieAuth scheme).
 :)

declare namespace login="http://exist-db.org/apps/dashboard/login";
declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

import module namespace roaster="http://e-editiones.org/roaster";
import module namespace auth="http://e-editiones.org/roaster/auth";

declare variable $login:auth-options := map {
    "path": request:get-context-path(),
    "samesite": "Lax",
    "httponly": true()
};

declare function login:lookup($name as xs:string) {
    function-lookup(xs:QName($name), 1)
};

(:~
 : POST /login — authenticate user and set cookie.
 :)
declare function login:login($request as map(*)) {
    let $user-param := ($request?body?user, request:get-parameter("user", ()))[1]
    let $pass-param := ($request?body?password, request:get-parameter("password", ()))[1]
    let $user := auth:login-user(
        $user-param,
        ($pass-param, "")[1],
        auth:add-cookie-name($request, $login:auth-options)
    )
    return
        if (exists($user)) then
            roaster:response(200, "application/json", map {
                "user": $user,
                "isAdmin": sm:is-dba($user)
            })
        else
            roaster:response(401, "application/json", map {
                "message": "Login failed"
            })
};

(:~
 : GET /login — check current login status.
 :)
declare function login:status($request as map(*)) {
    let $user := $request?user
    return
        if (exists($user) and $user?name ne "guest") then
            roaster:response(200, "application/json", map {
                "user": $user?name,
                "isAdmin": ($user?groups?* = "dba")
            })
        else
            roaster:response(200, "application/json", map {
                "user": "guest",
                "isAdmin": false()
            })
};

(:~
 : GET /logout — clear session and cookie.
 :)
declare function login:logout($request as map(*)) {
    auth:logout-user(auth:add-cookie-name($request, $login:auth-options)),
    roaster:response(200, "application/json", map {
        "message": "Logged out"
    })
};

roaster:route("modules/login-api.json", login:lookup#1)
