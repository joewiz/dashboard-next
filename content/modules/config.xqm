xquery version "3.1";

(:~
 : Application configuration module.
 :)
module namespace config="http://exist-db.org/apps/dashboard/config";

declare namespace repo="http://exist-db.org/xquery/repo";
declare namespace expath="http://expath.org/ns/pkg";

(:~ Determine the application root collection from the current module load path. :)
declare variable $config:app-root :=
    let $rawPath := system:get-module-load-path()
    let $modulePath :=
        if (starts-with($rawPath, "xmldb:exist://")) then
            if (starts-with($rawPath, "xmldb:exist://embedded-eXist-server")) then
                substring($rawPath, 36)
            else
                substring($rawPath, 15)
        else
            $rawPath
    return
        substring-before($modulePath, "/modules")
;

declare variable $config:repo-descriptor := doc($config:app-root || "/repo.xml")/repo:meta;

declare variable $config:expath-descriptor := doc($config:app-root || "/expath-pkg.xml")/expath:package;
