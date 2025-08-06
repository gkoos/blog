
import prismSetup from './.eleventy.prism.js';
import md from './src/_data/markdown.js';
import fs from 'fs';
import path from 'path';
import cssnano from 'cssnano';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import rssPlugin from '@11ty/eleventy-plugin-rss';

export default function (eleventyConfig) {
  prismSetup(eleventyConfig);
  eleventyConfig.setLibrary('md', md);
  eleventyConfig.addPlugin(rssPlugin);
  // Add a 'filterTags' filter to remove system tags
  eleventyConfig.addFilter('filterTags', function(tags, systemTags = ["posts", "all", "page"]) {
    if (!Array.isArray(tags)) return [];
    return tags.filter(tag => !systemTags.includes(tag));
  });

  // Add a 'toDate' filter to ensure a value is a Date object (simple version)
  eleventyConfig.addNunjucksFilter('toDate', function(val) {
    return new Date(val);
  });

  // Add a filter to fix 24:00:00 GMT to 00:00:00 GMT in RSS output
  eleventyConfig.addNunjucksFilter('fixRfc822Midnight', function(val) {
    if (typeof val === 'string') {
      return val.replace('24:00:00 GMT', '00:00:00 GMT');
    }
    return val;
  });
  //compile tailwind before eleventy processes the files

  eleventyConfig.on('eleventy.before', async () => {
    // Copy all assets (including favicon, images, etc.)
    const srcAssets = path.resolve('./src/assets');
    const distAssets = path.resolve('./dist/assets');
    function copyRecursive(src, dest) {
      if (!fs.existsSync(src)) return;
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
          copyRecursive(path.join(src, file), path.join(dest, file));
        }
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    copyRecursive(srcAssets, distAssets);

    // Now build Tailwind CSS to overwrite the copied styles.css with the freshly built one
    const tailwindInputPath = path.resolve('./src/assets/css/styles.css');
    const tailwindOutputPath = './dist/assets/css/styles.css';
    const cssContent = fs.readFileSync(tailwindInputPath, 'utf8');
    const outputDir = path.dirname(tailwindOutputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const processor = postcss([
      tailwindcss(),
      cssnano({ preset: 'default' }),
    ]);
    const result = await processor.process(cssContent, {
      from: tailwindInputPath,
      to: tailwindOutputPath,
    });
    fs.writeFileSync(tailwindOutputPath, result.css);
  });

  // Ensure posts are sorted by date descending
  eleventyConfig.addCollection("posts", function(collectionApi) {
    return collectionApi.getFilteredByGlob("src/posts/*.md").sort((a, b) => {
      return new Date(b.data.date) - new Date(a.data.date);
    });
  });

  return {
    dir: { input: 'src', output: 'dist' },
  };
}
