import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export default function() {
  const postsDir = path.resolve('./src/posts');
  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
  const tagMap = {};
  const posts = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(postsDir, file), 'utf8');
    const { data } = matter(content);
    if (!data.tags || !Array.isArray(data.tags)) continue;
    // Always include the post, but filter out 'posts' from tags for display and counting
    const filteredTags = data.tags.filter(t => t !== 'posts');
    posts.push({
      title: data.title || file.replace(/\.md$/, ''),
      date: data.date ? new Date(data.date) : new Date(0),
      url: `/posts/${file.replace(/\.md$/, '/')}`,
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
