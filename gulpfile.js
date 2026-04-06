/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
import { src, dest, series, parallel, watch as gulpWatch } from "gulp";
import { createClient } from "@existdb/gulp-exist";
import replace from "@existdb/gulp-replace-tmpl";
import rename from "gulp-rename";
import zip from "gulp-zip";
import del from "delete";
import { readFileSync, existsSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));
const { version, license, app } = packageJson;

// template replacements: first value wins
const replacements = [app, { version, license }];

// Read connection settings from .existdb.json
let existClient;
try {
  const existJson = JSON.parse(readFileSync("./.existdb.json", "utf-8"));
  const serverInfo = existJson.servers.localhost;
  const url = new URL(serverInfo.server);
  existClient = createClient({
    basic_auth: {
      user: serverInfo.user,
      pass: serverInfo.password
    },
    host: url.hostname,
    port: url.port || (url.protocol === "https:" ? "8443" : "8080"),
    secure: url.protocol === "https:",
  });
} catch (e) {
  // .existdb.json may be missing or server unreachable; OK for build-only usage
}

const packageFilename = `dashboard-${version}.xar`;

const paths = {
  staging: ".build",
  output: "dist",
};

// ==================== //
//    Clean tasks        //
// ==================== //

function clean(cb) {
  del([paths.staging, paths.output], cb);
}
export { clean };

// ==================== //
//    Copy XAR sources   //
// ==================== //

function copyXarSources() {
  return src([
    "controller.xq",
    "finish.xq",
    "modules/**/*",
    "templates/**/*",
    "resources/**/*",
  ], { encoding: false, base: "." })
    .pipe(dest(paths.staging));
}

function copyProjectFiles() {
  return src(["README.md", "LICENSE"], { allowEmpty: true, encoding: false })
    .pipe(dest(paths.staging));
}

// ==================== //
//    Template tasks     //
// ==================== //

function templates() {
  return src("*.tmpl")
    .pipe(replace(replacements, { unprefixed: true }))
    .pipe(rename((path) => { path.extname = ""; }))
    .pipe(dest(paths.staging));
}

// ==================== //
//    XAR packaging      //
// ==================== //

function createXar() {
  return src(`${paths.staging}/**/*`, { encoding: false })
    .pipe(zip(packageFilename))
    .pipe(dest(paths.output));
}

// ==================== //
//    Deploy to eXist    //
// ==================== //

function deployXar() {
  return src(`${paths.output}/${packageFilename}`, { encoding: false })
    .pipe(existClient.install({ packageUri: app.namespace }));
}

// ==================== //
//    Composed tasks     //
// ==================== //

const build = series(
  clean,
  parallel(copyXarSources, copyProjectFiles),
  templates,
  createXar
);

const install = series(build, deployXar);

export { build, install };

// default: build + deploy + watch
export default series(build, deployXar, function watchTask() {
  gulpWatch(["controller.xq", "modules/**/*", "templates/**/*", "resources/**/*"], build);
});
