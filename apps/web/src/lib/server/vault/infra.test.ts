// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../../../infra/${rel}`, import.meta.url)), 'utf8');

describe('vault infrastructure', () => {
  const bicep = read('azure/main.bicep');

  it('gives documents their own private container, apart from the Litestream replica', () => {
    expect(bicep).toMatch(/var documentsContainerName = 'documents'/);
    expect(bicep).toMatch(
      /resource documentsContainer '[^']+' = \{\s*parent: blobService\s*name: documentsContainerName\s*properties: \{ publicAccess: 'None' \}/
    );
    expect(bicep).toMatch(/allowBlobPublicAccess: false/);
  });

  it('expires previous document versions after one day', () => {
    expect(bicep).toMatch(
      /name: 'expire-document-versions'[\s\S]*?prefixMatch: \['\$\{documentsContainerName\}\/'\][\s\S]*?version: \{ delete: \{ daysAfterCreationGreaterThan: 1 \} \}/
    );
  });

  it('turns the blob vault on for the web app and raises the body limit', () => {
    const start = bicep.indexOf("name: 'web'");
    const web = bicep.slice(start, bicep.indexOf('optionalEnv', start));
    expect(web).toMatch(/\{ name: 'VAULT_BACKEND', value: 'blob' \}/);
    expect(web).toMatch(/\{ name: 'VAULT_BLOB_CONTAINER', value: documentsContainerName \}/);
    expect(web).toMatch(/\{ name: 'BODY_SIZE_LIMIT', value: '21M' \}/);
    expect(web).not.toMatch(/VAULT_DIR/);
  });

  it('uses the filesystem vault in local compose and the dev env example', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toMatch(/VAULT_BACKEND: filesystem/);
    expect(compose).toMatch(/VAULT_DIR: \/data\/vault/);
    expect(compose).toMatch(/BODY_SIZE_LIMIT: 21M/);
    const env = read('.env.dev.example');
    expect(env).toMatch(/^VAULT_BACKEND=filesystem$/m);
    expect(env).toMatch(/^VAULT_DIR=\/data\/vault$/m);
    expect(env).toMatch(/^BODY_SIZE_LIMIT=21M$/m);
  });
});
