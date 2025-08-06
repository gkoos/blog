module.exports = {
  content: [
    "./src/**/*.{njk,md,html,js}",
    "./*.md"
  ],
  plugins: [
    require('@tailwindcss/typography'),
  ],
  darkMode: "class",
};
