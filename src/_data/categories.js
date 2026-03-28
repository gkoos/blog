import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export default function() {
  const postsDir = path.resolve('./src/posts');
  const files = [];

  function collectArticleFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectArticleFiles(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'article.md') {
        files.push(fullPath);
      }
    }
  }

  collectArticleFiles(postsDir);
  const tagMap = {};
  const posts = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const { data } = matter(content);
    if (!data.tags || !Array.isArray(data.tags)) continue;
    // Always include the post, but filter out 'posts' from tags for display and counting
    const filteredTags = data.tags.filter(t => t !== 'posts');
    const slug = path.basename(path.dirname(file));
    posts.push({
      title: data.title || slug,
      date: data.date ? new Date(data.date) : new Date(0),
      url: `/posts/${slug}/`,
      tags: filteredTags,
    });
    for (const tag of filteredTags) {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    }
  }

  return {
    categories: Object.entries(tagMap).map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag)),
    posts: posts.sort((a, b) => b.date - a.date),
  };
}
