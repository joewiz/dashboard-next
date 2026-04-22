xquery version "3.1";

(:~
 : System information module.
 : Detailed system info, Java properties, scheduled jobs.
 :)
module namespace sysinfo="http://exist-db.org/apps/dashboard/system-info";

declare namespace templates="http://exist-db.org/xquery/html-templating";
declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

(:~
 : Get full system information.
 :)
declare function sysinfo:get-info() as map(*) {
    map {
        "db": map {
            "name": system:get-product-name(),
            "version": system:get-version(),
            "build": system:get-build(),
            "revision": system:get-revision(),
            "exist-home": system:get-exist-home(),
            "data-dir": util:system-property("exist.home") || "/data",
            "modules-dir": util:system-property("exist.home") || "/autodeploy"
        },
        "java": map {
            "version": util:system-property("java.version"),
            "vendor": util:system-property("java.vendor"),
            "vm-name": util:system-property("java.vm.name"),
            "vm-version": util:system-property("java.vm.version"),
            "java-home": util:system-property("java.home"),
            "class-path": util:system-property("java.class.path"),
            "max-memory": system:get-memory-max(),
            "free-memory": system:get-memory-free()
        },
        "os": map {
            "name": util:system-property("os.name"),
            "version": util:system-property("os.version"),
            "arch": util:system-property("os.arch"),
            "processors": util:system-property("os.arch")
        },
        "uptime": system:get-uptime() div xs:dayTimeDuration("PT0.001S"),
        "scheduler-jobs": array {
            if (exists(function-lookup(xs:QName("scheduler:get-scheduled-jobs"), 0))) then
                let $jobs := scheduler:get-scheduled-jobs()
                for $job in $jobs//scheduler:job
                return map {
                    "name": string(($job/@name, "")[1]),
                    "group": string(($job/@group, "")[1]),
                    "trigger": string(($job/scheduler:trigger/@name, "")[1]),
                    "state": string(($job/scheduler:trigger/@state, "")[1]),
                    "start": string(($job/scheduler:trigger/@startTime, "")[1]),
                    "end": string(($job/scheduler:trigger/@endTime, "")[1]),
                    "expression": string(($job/scheduler:trigger/scheduler:expression, "")[1])
                }
            else ()
        }
    }
};
