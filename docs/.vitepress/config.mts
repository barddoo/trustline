import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Trustline",
  description: "Service identity and authorization for Node.js",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Docs", link: "/get-started" },
      { text: "Middleware", link: "/middleware" },
      { text: "Reference", link: "/reference" },
      { text: "Roadmap", link: "/roadmap" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Get Started", link: "/get-started" },
          { text: "Concepts", link: "/concepts" },
          { text: "Middleware", link: "/middleware" },
          { text: "Reference", link: "/reference" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/barddoo/trustline" },
    ],
    search: {
      provider: "local",
    },
  },
});
