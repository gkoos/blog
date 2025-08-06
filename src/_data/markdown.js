import markdownIt from "markdown-it";
import prism from "prismjs";
import anchor from "markdown-it-anchor";
import toc from "markdown-it-toc-done-right";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-css.js";
import "prismjs/components/prism-markup.js";

const md = markdownIt({
  html: true,
  highlight: function (str, lang) {
    let grammar = prism.languages[lang] || prism.languages.javascript;
    let html = prism.highlight(str, grammar, lang);
    return `<pre class="language-${lang}"><code class="language-${lang}">${html}</code></pre>`;
  }
})
.use(anchor, { permalink: anchor.permalink.headerLink() })
.use(toc);

export default md;
