xquery version "3.1";

(:~
 : Server-side template functions for dashboard pages.
 :
 : These are called via data-template attributes in content page HTML.
 : Most dashboard data comes from exist-api via client-side JavaScript,
 : but some initial state is rendered server-side for progressive enhancement.
 :)
module namespace app="http://exist-db.org/apps/dashboard";

declare namespace templates="http://exist-db.org/xquery/html-templating";

import module namespace config="http://exist-db.org/apps/dashboard/config" at "config.xqm";

(:~
 : Inject the active tab name into the model so templates can highlight
 : the current tab in the navigation.
 :)
declare
    %templates:wrap
function app:active-tab($node as node(), $model as map(*)) as map(*) {
    map {
        "active-tab": request:get-attribute("active-tab")
    }
};

(:~
 : Render system info server-side as a fallback when exist-api is not available.
 : JavaScript will replace this with live data from exist-api when possible.
 :)
declare
    %templates:wrap
function app:system-info($node as node(), $model as map(*)) as map(*) {
    map {
        "product-name": system:get-product-name(),
        "product-version": system:get-version(),
        "build": system:get-build(),
        "revision": system:get-revision(),
        "java-version": util:system-property("java.version"),
        "java-vendor": util:system-property("java.vendor"),
        "os-name": util:system-property("os.name"),
        "os-arch": util:system-property("os.arch"),
        "data-dir": util:system-property("exist.home")
    }
};
