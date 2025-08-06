import Prism from "prismjs";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-css.js";
import "prismjs/components/prism-markup.js";


export default function(eleventyConfig) {
  eleventyConfig.addPairedShortcode("codeblock", function(content, lang = "js") {
    const grammar = Prism.languages[lang] || Prism.languages.javascript;
    const html = Prism.highlight(content, grammar, lang);
    return `<pre class="language-${lang}"><code class="language-${lang}">${html}</code></pre>`;
  });
};
