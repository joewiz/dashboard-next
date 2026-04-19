xquery version "3.1";

(:~
 : Logout handler: clears the persistent login cookie and redirects.
 :)

import module namespace login="http://exist-db.org/xquery/login"
    at "resource:org/exist/xquery/modules/persistentlogin/login.xql";

(: Clear the persistent login by passing logout=true :)
let $_ := login:set-user("org.exist.login.user", (), false())

(: Expire the login cookie :)
let $context-path := request:get-context-path()
let $_ := response:set-cookie("org.exist.login.user", "", xs:dayTimeDuration("-P1D"),
    false(), (), $context-path)

(: Invalidate the HTTP session :)
let $_ := session:invalidate()

(: Redirect — use the redirect parameter or default to login page :)
let $redirect := (request:get-parameter("redirect", ()), $context-path || "/apps/dashboard/login")[1]
return
    response:redirect-to(xs:anyURI($redirect))
