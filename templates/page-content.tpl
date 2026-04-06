---json
{
    "templating": {
        "extends": "templates/base-page.html"
    }
}
---
[% template title %]Dashboard[% endtemplate %]

[% template head %]
    <link rel="stylesheet" href="[[ $context-path ]]/resources/css/dashboard.css"/>
[% endtemplate %]

[% template content %]
<div class="dashboard">
    <nav class="dashboard-tabs" aria-label="Dashboard navigation">
        <ul>
            <li><a href="[[ $context-path ]]/" class="[[ $tabs?home ]]">Home</a></li>
            <li><a href="[[ $context-path ]]/packages" class="[[ $tabs?packages ]]">Packages</a></li>
            <li><a href="[[ $context-path ]]/users" class="[[ $tabs?users ]]">Users</a></li>
            <li><a href="[[ $context-path ]]/monitoring" class="[[ $tabs?monitoring ]]">Monitoring</a></li>
            <li><a href="[[ $context-path ]]/profiling" class="[[ $tabs?profiling ]]">Profiling</a></li>
            <li><a href="[[ $context-path ]]/console" class="[[ $tabs?console ]]">Console</a></li>
            <li><a href="[[ $context-path ]]/indexes" class="[[ $tabs?indexes ]]">Indexes</a></li>
            <li><a href="[[ $context-path ]]/system" class="[[ $tabs?system ]]">System</a></li>
        </ul>
    </nav>

    <section class="dashboard-content">
        [[ $tab-content ]]
    </section>
</div>

<script type="module" src="[[ $context-path ]]/resources/js/dashboard.js"></script>
[% endtemplate %]
