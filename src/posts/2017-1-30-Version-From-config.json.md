---
layout: layouts/post.njk
title: Version From config.json
description: How to use Webpack to inject version number from package.json into your app.
date: 2017-01-29
tags:
  - posts
  - javascript
  - webpack
---

[Semvering](http://semver.org) your app is cool. Especially as your software grows into maturity and you can watch those numbers increase! What's not so cool, however, is to maintain those version numbers throughout your apps, for example in your About page.

So why not just fetching it from `package.json`, where you're supposed to provide the project metadata anyway?
OK, the quick and dirty solution would be to require your `package.json` into your application and display the version number on demand:

```javascript
var pjson = require('./package.json');
console.log(pjson.version);
```

On the client side it has serious security implications though, as you don't want to expose your `package.json` to everyone out there. Dependency version numbers, build and test commands better be hidden from prying eyes. So what can you do now (assuming using webpack)?
Well despite it's (in my strong opinion) rather counterintuitive syntax, there are very few things one cannot do with webpack. Here you can just add these lines to your `webpack.config.js`:

```javascript
plugins: [
    new webpack.DefinePlugin({
        VERSION: JSON.stringify(require("./package.json").version)
    })
]
```

And then anywhere in your app you can use VERSION. For example, if your About page is rendered in a react component:

```javascript
var About = (props) => {
    return (
        <div>
            ...
            <p className="version">Version {VERSION}</p>
            ...
        </div>
    );
}
```