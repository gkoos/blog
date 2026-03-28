import path from 'path';

export default {
  permalink: (data) => {
    const inputPath = data.page?.inputPath || '';
    const slug = path.basename(path.dirname(inputPath));
    return `/posts/${slug}/`;
  },
};