xquery version "3.1";

(:~
 : API dispatcher for JSON endpoints.
 : Called from the controller via forward, reads the "api-action"
 : attribute to determine what to do.
 :)

import module namespace prof="http://exist-db.org/apps/dashboard/profiling" at "profiling.xqm";
import module namespace pkgs="http://exist-db.org/apps/dashboard/packages" at "packages.xqm";
import module namespace usrmgr="http://exist-db.org/apps/dashboard/users" at "users.xqm";
import module namespace idx="http://exist-db.org/apps/dashboard/indexes" at "indexes.xqm";
import module namespace sysinfo="http://exist-db.org/apps/dashboard/system-info" at "system-info.xqm";

declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

declare option output:method "json";
declare option output:media-type "application/json";

let $action := request:get-attribute("api-action")
return
    switch ($action)
        case "forbidden" return (
            response:set-status-code(403),
            map { "error": "Forbidden" }
        )
        (: Profiling :)
        case "profiling-action" return
            prof:action(request:get-parameter("action", ""))
        case "profiling-data" return
            prof:get-trace()

        (: Packages :)
        case "packages-data" return
            pkgs:list()
        case "packages-available" return
            pkgs:available()
        case "packages-action" return
            let $a := request:get-parameter("action", "")
            return
                switch ($a)
                    case "install" return
                        pkgs:install(request:get-parameter("url", ""))
                    case "remove" return
                        pkgs:remove(request:get-parameter("uri", ""))
                    default return
                        map { "error": "Unknown action" }

        (: Users :)
        case "users-data" return
            usrmgr:list-users()
        case "groups-data" return
            usrmgr:list-groups()
        case "users-action" return
            let $a := request:get-parameter("action", "")
            let $name := request:get-parameter("name", "")
            let $password := request:get-parameter("password", "")
            let $groups := tokenize(request:get-parameter("groups", ""), "\s*,\s*")
            return
                switch ($a)
                    case "create" return usrmgr:create-user($name, $password, $groups)
                    case "update" return usrmgr:update-user($name, $password, $groups)
                    case "delete" return usrmgr:delete-user($name)
                    case "create-group" return usrmgr:create-group($name)
                    case "delete-group" return usrmgr:delete-group($name)
                    default return map { "error": "Unknown action" }

        (: Indexes :)
        case "indexes-collections" return
            idx:list-configured-collections()
        case "indexes-data" return
            idx:get-indexes(request:get-parameter("collection", ""))
        case "indexes-keys" return
            idx:get-keys(
                request:get-parameter("collection", ""),
                request:get-parameter("item", ""),
                request:get-parameter("type", ""),
                xs:integer((request:get-parameter("max", ()), 50)[1])
            )

        (: System :)
        case "system-data" return
            sysinfo:get-info()

        default return
            map { "error": "Unknown API action: " || $action }
