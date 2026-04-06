xquery version "3.1";

(:~
 : User and group management module.
 : Direct sm:* calls for when exist-api is not available.
 :)
module namespace usrmgr="http://exist-db.org/apps/dashboard/users";

declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

(:~
 : List all users with group memberships.
 :)
declare function usrmgr:list-users() as map(*) {
    let $users :=
        for $user in sm:list-users()
        let $groups := sm:get-user-groups($user)
        let $enabled := sm:is-account-enabled($user)
        order by $user
        return map {
            "name": $user,
            "groups": array { $groups },
            "enabled": $enabled
        }
    return map { "users": array { $users } }
};

(:~
 : List all groups with managers and members.
 :)
declare function usrmgr:list-groups() as map(*) {
    let $groups :=
        for $group in sm:list-groups()
        let $managers :=
            try { sm:get-group-managers($group) } catch * { () }
        let $members :=
            try { sm:get-group-members($group) } catch * { () }
        order by $group
        return map {
            "name": $group,
            "managers": array { $managers },
            "members": array { $members }
        }
    return map { "groups": array { $groups } }
};

(:~
 : Create a new user.
 :)
declare function usrmgr:create-user($name as xs:string, $password as xs:string, $groups as xs:string*) as map(*) {
    try {
        let $primary := ($groups[1], "guest")[1]
        return (
            sm:create-account($name, $password, $primary, $groups[position() gt 1]),
            map { "status": "created", "name": $name }
        )
    } catch * {
        map { "error": $err:description }
    }
};

(:~
 : Update user password or group membership.
 :)
declare function usrmgr:update-user($name as xs:string, $password as xs:string?, $groups as xs:string*) as map(*) {
    try {
        if ($password and $password ne "") then
            sm:passwd($name, $password)
        else (),
        if (exists($groups)) then (
            (: Remove from all current groups, add to new ones :)
            for $g in sm:get-user-groups($name)
            where $g ne $groups[1] (: don't remove primary group :)
            return
                try { sm:remove-group-member($g, $name) } catch * { () },
            for $g in $groups
            return
                try { sm:add-group-member($g, $name) } catch * { () }
        ) else (),
        map { "status": "updated" }
    } catch * {
        map { "error": $err:description }
    }
};

(:~
 : Delete a user.
 :)
declare function usrmgr:delete-user($name as xs:string) as map(*) {
    try {
        sm:remove-account($name),
        map { "status": "deleted" }
    } catch * {
        map { "error": $err:description }
    }
};

(:~
 : Create a new group.
 :)
declare function usrmgr:create-group($name as xs:string) as map(*) {
    try {
        sm:create-group($name),
        map { "status": "created", "name": $name }
    } catch * {
        map { "error": $err:description }
    }
};

(:~
 : Delete a group.
 :)
declare function usrmgr:delete-group($name as xs:string) as map(*) {
    try {
        sm:remove-group($name),
        map { "status": "deleted" }
    } catch * {
        map { "error": $err:description }
    }
};
