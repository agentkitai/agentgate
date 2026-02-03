import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'AgentGate',
  description: 'Human-in-the-loop approval system for AI agents',
  
  // Ignore localhost links (documentation references)
  ignoreDeadLinks: [
    /^http:\/\/localhost/,
  ],
  
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Reference', link: '/configuration' },
      { text: 'GitHub', link: 'https://github.com/your-org/agentgate' }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Configuration', link: '/configuration' },
        ]
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Docker', link: '/docker' },
          { text: 'GitHub Action', link: '/github-action' },
        ]
      },
      {
        text: 'Developer Tools',
        items: [
          { text: 'SDK', link: '/sdk' },
          { text: 'CLI', link: '/cli' },
          { text: 'MCP Server', link: '/mcp' },
        ]
      },
      {
        text: 'Integrations',
        items: [
          { text: 'Slack', link: '/integrations/slack' },
          { text: 'Discord', link: '/integrations/discord' },
          { text: 'Email', link: '/integrations/email' },
          { text: 'Webhooks', link: '/integrations/webhooks' },
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: 'REST API', link: '/api' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-org/agentgate' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 AgentGate'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/your-org/agentgate/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    }
  }
})
