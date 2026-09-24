import path from 'path';

const ARTICLE_FILE = 'article.md';

export default {
  // Include these pages in the Pagefind search index.
  pagefindBody: true,
  permalink: (data) => {
    const inputPath = data.page?.inputPath || '';
    // Only article.md is published as a post. Other markdown files that live
    // beside it (e.g. draft outlines) are supporting material, not pages.
    if (path.basename(inputPath) !== ARTICLE_FILE) {
      return false;
    }
    const slug = path.basename(path.dirname(inputPath));
    return `/posts/${slug}/`;
  },
};