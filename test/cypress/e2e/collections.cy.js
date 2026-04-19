/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

// Use full URL for API calls outside the dashboard baseUrl
const API_BASE = 'http://localhost:8080/exist/apps/exist-api/api';
const TEST_COLLECTION = '/db/test-collections-cypress';

describe('Collections Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/collections');
  });

  it('should load the collections page', () => {
    cy.get('.collections-page').should('exist');
    cy.get('h1').should('contain', 'Collections');
  });

  it('should display the collection tree starting at /db', () => {
    cy.get('.tree-node[data-path="/db"]').should('exist');
    cy.get('.tree-node-row.active').should('exist');
  });

  it('should show child collections in the tree', () => {
    cy.get('.tree-node[data-path="/db"] > .tree-children .tree-node', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
  });

  it('should display breadcrumb for /db', () => {
    cy.get('#collections-breadcrumb').should('contain', 'db');
  });

  it('should show the resource table', () => {
    cy.get('#resource-table').should('exist');
    cy.get('#resource-table thead th').should('have.length', 5);
  });

  it('should list items when navigating to a collection', () => {
    // /db/apps should always exist and contain items
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
    cy.get('#collections-breadcrumb').should('contain', 'apps');
  });

  it('should navigate into a subcollection by clicking a row', () => {
    // Navigate to /db/apps first
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
    // Click on the first collection row to navigate into it
    cy.get('#resource-body tr[data-path] .resource-icon.folder')
      .first().parent().parent().dblclick();
    // Breadcrumb should now have more segments
    cy.get('.breadcrumb-link').should('have.length.greaterThan', 0);
  });

  it('should navigate up via the Up button', () => {
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#collections-breadcrumb').should('contain', 'apps');
    cy.get('#coll-up-btn').click();
    cy.get('.breadcrumb-current').should('contain', 'db');
  });

  it('should navigate via breadcrumb links', () => {
    // Go deep: /db/apps
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
    // Click the first collection to go deeper
    cy.get('#resource-body tr[data-path] .resource-icon.folder')
      .first().parent().parent().dblclick();
    // Click the "db" breadcrumb link to go back to root
    cy.get('.breadcrumb-link').contains('db').click();
    cy.get('.breadcrumb-current').should('contain', 'db');
  });

  it('should expand/collapse tree nodes', () => {
    // The /db node should be expanded by default
    cy.get('.tree-node[data-path="/db"] > .tree-node-row .tree-icon')
      .should('have.class', 'expanded');
    // Expand /db/apps
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row .tree-icon').click();
    cy.get('.tree-node[data-path="/db/apps"] > .tree-children .tree-node', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
    // Collapse it
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row .tree-icon').click();
    cy.get('.tree-node[data-path="/db/apps"] > .tree-children').should('be.hidden');
  });

  it('should sort columns when clicking headers', () => {
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
    // Click Name header to toggle sort
    cy.get('th[data-sort="name"]').click();
    cy.get('th[data-sort="name"]').should('have.class', 'sort-desc');
    cy.get('th[data-sort="name"]').click();
    cy.get('th[data-sort="name"]').should('have.class', 'sort-asc');
  });

  it('should filter by name', () => {
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 })
      .should('have.length.greaterThan', 0);
    cy.get('#coll-filter').type('zzz-nonexistent-zzz');
    cy.get('#resource-body .empty-state').should('contain', 'No items match');
    cy.get('#coll-filter').clear();
    cy.get('#resource-body tr[data-path]').should('have.length.greaterThan', 0);
  });

  it('should select an item and show the info bar', () => {
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 }).first().click();
    cy.get('#collections-info').should('not.be.hidden');
    cy.get('#info-details').should('not.be.empty');
  });

  it('should show the action bar when items are selected', () => {
    cy.get('.tree-node[data-path="/db/apps"] > .tree-node-row').click();
    cy.get('#resource-body tr[data-path]', { timeout: 10000 }).first().click();
    cy.get('#collections-actions').should('not.be.hidden');
    cy.get('#action-count').should('contain', '1 selected');
  });

  it('should disable the Up button at /db', () => {
    cy.get('#coll-up-btn').should('be.disabled');
  });
});

describe('Collections Tab — public access', () => {
  it('should be accessible without login', () => {
    cy.clearCookies();
    cy.visit('/collections');
    cy.get('.collections-page').should('exist');
    cy.get('h1').should('contain', 'Collections');
  });

  it('should disable write controls for unauthenticated users', () => {
    cy.clearCookies();
    cy.visit('/collections');
    cy.get('.tree-node[data-path="/db"]', { timeout: 10000 }).should('exist');
    // Wait for resources to load
    cy.get('#resource-body tr', { timeout: 10000 }).should('exist');
    // New Collection and Upload buttons should be disabled
    cy.get('#coll-new-btn').should('be.disabled');
    cy.get('#coll-upload').should('be.disabled');
  });
});

describe('Collections CRUD operations', () => {
  before(() => {
    // Clean up test collection if it exists from a previous run
    cy.loginApi();
    cy.request({
      method: 'DELETE',
      url: `${API_BASE}/db/collection?path=${encodeURIComponent(TEST_COLLECTION)}&force=true`,
      failOnStatusCode: false,
    });
  });

  beforeEach(() => {
    cy.loginAndVisit('/collections');
    // Wait for tree to load
    cy.get('.tree-node[data-path="/db"]', { timeout: 10000 }).should('exist');
  });

  it('should create a new collection', () => {
    // Navigate to /db
    cy.get('.tree-node[data-path="/db"] > .tree-node-row').click();
    cy.get('#resource-body tr', { timeout: 10000 }).should('exist');

    cy.get('#coll-new-btn').click();
    cy.get('#create-collection-dialog').should('be.visible');
    cy.get('#new-collection-name').type('test-collections-cypress');
    cy.get('#create-collection-confirm').click();
    cy.get('#create-collection-dialog').should('not.be.visible');

    // Verify it appears in the resource list
    cy.get('#resource-body').should('contain', 'test-collections-cypress');
  });

  it('should upload a file', () => {
    // Upload via REST API (the same method the UI uses under the hood)
    cy.request({
      method: 'PUT',
      url: `http://localhost:8080/exist/rest${TEST_COLLECTION}/test-upload.xml`,
      body: '<test>hello</test>',
      headers: {
        'Content-Type': 'application/xml',
        'Authorization': 'Basic ' + btoa('admin:'),
      },
    }).its('status').should('eq', 201);

    // Navigate to the test collection and verify the file appears
    cy.get('.tree-node[data-path="/db"] > .tree-node-row').click();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-collections-cypress');
    cy.get(`#resource-body tr[data-path="${TEST_COLLECTION}"]`).dblclick();
    cy.get('.breadcrumb-current').should('contain', 'test-collections-cypress');
    cy.get('#resource-body').should('contain', 'test-upload.xml');
  });

  it('should show Open in eXide link for XML resources', () => {
    cy.get('.tree-node[data-path="/db"] > .tree-node-row').click();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-collections-cypress');
    cy.get(`#resource-body tr[data-path="${TEST_COLLECTION}"]`).dblclick();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-upload.xml');

    // Select the file
    cy.get('#resource-body tr[data-path]').contains('test-upload.xml').click();
    cy.get('#collections-info').should('not.be.hidden');
    cy.get('#info-actions').should('contain', 'Open in eXide');
    cy.get('#info-actions').should('contain', 'Download');
  });

  it('should rename a resource via the context menu', () => {
    cy.get('.tree-node[data-path="/db"] > .tree-node-row').click();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-collections-cypress');
    cy.get(`#resource-body tr[data-path="${TEST_COLLECTION}"]`).dblclick();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-upload.xml');

    // Right-click to open context menu, then click Rename
    cy.get('#resource-body tr[data-path]').contains('test-upload.xml').rightclick();
    cy.get('.context-menu').should('be.visible');
    cy.get('.context-menu-item').contains('Rename').click();
    cy.get('#rename-dialog').should('be.visible');
    cy.get('#rename-input').clear().type('renamed-file.xml');
    cy.get('#rename-confirm').click();
    cy.get('#rename-dialog').should('not.be.visible');
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'renamed-file.xml');
    cy.get('#resource-body').should('not.contain', 'test-upload.xml');
  });

  it('should delete a resource with confirmation', () => {
    cy.get('.tree-node[data-path="/db"] > .tree-node-row').click();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-collections-cypress');
    cy.get(`#resource-body tr[data-path="${TEST_COLLECTION}"]`).dblclick();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'renamed-file.xml');

    // Select and delete
    cy.get('#resource-body tr[data-path]').contains('renamed-file.xml').click();
    cy.get('#action-delete').click();
    cy.get('#delete-confirm-dialog').should('be.visible');
    cy.get('#delete-confirm-message').should('contain', 'renamed-file.xml');
    cy.get('#delete-confirm-yes').click();
    cy.get('#delete-confirm-dialog').should('not.be.visible');
    cy.get('#resource-body').should('not.contain', 'renamed-file.xml');
  });

  it('should delete the test collection', () => {
    cy.get('.tree-node[data-path="/db"] > .tree-node-row').click();
    cy.get('#resource-body', { timeout: 10000 }).should('contain', 'test-collections-cypress');

    // Select and delete the collection
    cy.get(`#resource-body tr[data-path="${TEST_COLLECTION}"]`).click();
    cy.get('#action-delete').click();
    cy.get('#delete-confirm-dialog').should('be.visible');
    cy.get('#delete-confirm-yes').click();
    cy.get('#delete-confirm-dialog').should('not.be.visible');
    cy.get('#resource-body').should('not.contain', 'test-collections-cypress');
  });

  after(() => {
    // Final cleanup
    cy.loginApi();
    cy.request({
      method: 'DELETE',
      url: `${API_BASE}/db/collection?path=${encodeURIComponent(TEST_COLLECTION)}`,
      failOnStatusCode: false,
    });
  });
});
