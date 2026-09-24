import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SERIES_PREFIX = 'series--';

export default function () {
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

  const seriesMap = new Map();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const { data } = matter(content);
    if (!data.tags || !Array.isArray(data.tags)) continue;
    const seriesTags = data.tags.filter((tag) => typeof tag === 'string' && tag.startsWith(SERIES_PREFIX));
    if (seriesTags.length === 0) continue;
    const slug = path.basename(path.dirname(file));
    const post = {
      title: data.title || slug,
      date: data.date ? new Date(data.date) : new Date(0),
      url: `/posts/${slug}/`,
    };
    for (const seriesTag of seriesTags) {
      const title = seriesTag.slice(SERIES_PREFIX.length).trim();
      if (!title) continue;
      if (!seriesMap.has(title)) seriesMap.set(title, []);
      seriesMap.get(title).push(post);
    }
  }

  return [...seriesMap.entries()]
    .map(([title, posts]) => {
      // Within a series: chronological (oldest first)
      const sorted = posts.slice().sort((a, b) => a.date - b.date);
      return { title, firstDate: sorted[0].date, posts: sorted };
    })
    // Across series: newest first by the first part's publish date
    .sort((a, b) => b.firstDate - a.firstDate);
}
