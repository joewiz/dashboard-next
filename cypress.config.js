import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8080/exist/apps/dashboard',
    specPattern: 'test/cypress/e2e/**/*.cy.js',
    supportFile: 'test/cypress/support/e2e.js',
    fixturesFolder: 'test/cypress/fixtures',
    screenshotsFolder: 'target/cypress/screenshots',
    videosFolder: 'target/cypress/videos',
    downloadsFolder: 'target/cypress/downloads',
    defaultCommandTimeout: 15000,
    responseTimeout: 30000,
    excludeSpecPattern: ['**/examples/**'],
  },
});
