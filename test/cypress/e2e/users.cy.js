/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Users Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/users');
  });

  it('should load the users page', () => {
    cy.get('.users-page').should('exist');
    cy.get('h1').should('contain', 'Users');
  });

  it('should list users including admin', () => {
    cy.get('#users-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#users-body').should('contain', 'admin');
  });

  it('should filter users', () => {
    cy.get('#users-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#user-filter').type('admin');
    cy.get('#users-body').should('contain', 'admin');
  });

  it('should show create user dialog', () => {
    cy.get('#create-user-btn').click();
    cy.get('#user-dialog').should('be.visible');
    cy.get('#user-dialog-title').should('contain', 'Create');
    cy.get('#user-name').should('be.visible');
    cy.get('#user-password').should('be.visible');

    cy.get('#user-cancel').click();
    cy.get('#user-dialog').should('not.be.visible');
  });

  it('should switch to Groups sub-tab', () => {
    cy.get('.tab-btn').contains('Groups').click();
    cy.get('#panel-groups-list').should('be.visible');
    cy.get('#groups-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#groups-body').should('contain', 'dba');
  });

  it('should show edit dialog when clicking Edit on a user', () => {
    cy.get('#users-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#users-body .edit-user').first().click();
    cy.get('#user-dialog').should('be.visible');
    cy.get('#user-dialog-title').should('contain', 'Edit');
    cy.get('#user-name').should('be.disabled');

    cy.get('#user-cancel').click();
  });

  it('should create and delete a test user', () => {
    const testUser = 'cypress-test-' + Date.now();

    // Create
    cy.get('#create-user-btn').click();
    cy.get('#user-name').type(testUser);
    cy.get('#user-password').type('testpass');
    cy.get('#user-groups').type('guest');
    cy.get('#user-save').click();
    cy.get('#user-dialog').should('not.be.visible');

    // Verify created
    cy.get('#users-body', { timeout: 10000 }).should('contain', testUser);

    // Delete
    cy.get(`#users-body .delete-user[data-name="${testUser}"]`).click();
    // Confirm dialog — Cypress auto-confirms window.confirm
    cy.get('#users-body').should('not.contain', testUser);
  });
});

describe('Users API endpoint', () => {
  it('should return user list as JSON', () => {
    cy.loginApi();
    cy.request('/users/data').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('users');
      expect(response.body.users).to.be.an('array');
      const admin = response.body.users.find((u) => u.name === 'admin');
      expect(admin).to.exist;
      expect(admin.groups).to.include('dba');
    });
  });

  it('should return group list as JSON', () => {
    cy.loginApi();
    cy.request('/users/groups-data').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('groups');
      expect(response.body.groups).to.be.an('array');
    });
  });
});
