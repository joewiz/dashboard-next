xquery version "3.1";

(:~
 : Backup API — list, trigger, and retrieve backups.
 : Mirrors the old dashboard's backup module.
 :)

import module namespace backups="http://exist-db.org/xquery/backups"
    at "java:org.exist.backup.xquery.BackupModule";

declare namespace json="http://www.json.org";
declare namespace output="http://www.w3.org/2010/xslt-xquery-serialization";

declare variable $local:BACKUP_DIR := "export";

declare function local:list() {
    let $backups := backups:list($local:BACKUP_DIR)/exist:backup
    return (
        util:declare-option("exist:serialize", "method=json media-type=application/json"),
        if (empty($backups)) then
            <json:value><json:value json:array="true"/></json:value>
        else
            <json:value>
            {
                for $backup in $backups
                order by $backup/exist:date/string() descending
                return
                    <json:value json:array="true">
                        <name>{$backup/@file/string()}</name>
                        <created>{$backup/exist:date/string()}</created>
                        <incremental>{$backup/exist:incremental/text()}</incremental>
                    </json:value>
            }
            </json:value>
    )
};

declare function local:trigger() {
    let $zip := request:get-parameter("zip", ())
    let $incremental := request:get-parameter("inc", ())
    let $params :=
        <parameters>
            <param name="output" value="{$local:BACKUP_DIR}"/>
            <param name="backup" value="yes"/>
            <param name="incremental" value="{if ($incremental) then 'yes' else 'no'}"/>
            <param name="zip" value="{if ($zip) then 'yes' else 'no'}"/>
        </parameters>
    return (
        util:declare-option("exist:serialize", "method=json media-type=application/json"),
        system:trigger-system-task("org.exist.storage.ConsistencyCheckTask", $params),
        <response status="ok"/>
    )
};

declare function local:retrieve() {
    let $archive := request:get-parameter("archive", ())
    return
        if ($archive) then (
            response:set-header("Content-Disposition", concat("attachment; filename=", $archive)),
            backups:retrieve($local:BACKUP_DIR, $archive)
        ) else
            ()
};

let $action := request:get-parameter("action", ())
return
    if ($action = "trigger") then
        local:trigger()
    else if ($action = "retrieve") then
        local:retrieve()
    else
        local:list()
