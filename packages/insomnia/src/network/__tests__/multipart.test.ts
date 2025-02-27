import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';
import fs from 'fs';
import path from 'path';

import { globalBeforeEach } from '../../__jest__/before-each';
import { buildMultipart, DEFAULT_BOUNDARY } from '../multipart';

window.app = electron.app;

describe('buildMultipart()', () => {
  beforeEach(globalBeforeEach);

  it('builds a simple request', async () => {
    const { filePath, boundary, contentLength } = await buildMultipart([
      {
        name: 'foo',
        value: 'bar',
      },
      {
        name: 'multi-line',
        value: 'Hello\nWorld!',
      },
    ]);
    expect(boundary).toBe(DEFAULT_BOUNDARY);
    expect(contentLength).toBe(189);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="foo"',
        '',
        'bar',
        `--${boundary}`,
        'Content-Disposition: form-data; name="multi-line"',
        '',
        'Hello\nWorld!',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );
  });

  it('builds a multiline request with content-type', async () => {
    const { filePath, boundary, contentLength } = await buildMultipart([
      {
        name: 'foo',
        value: 'bar',
      },
      {
        name: 'json',
        value: '{"hello": "world"}',
        multiline: 'application/json',
      },
      {
        name: 'text',
        value: 'text',
        multiline: true,
      },
    ]);
    expect(boundary).toBe(DEFAULT_BOUNDARY);
    expect(contentLength).toBe(297);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="foo"',
        '',
        'bar',
        `--${boundary}`,
        'Content-Disposition: form-data; name="json"',
        'Content-Type: application/json',
        '',
        '{"hello": "world"}',
        `--${boundary}`,
        'Content-Disposition: form-data; name="text"',
        '',
        'text',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );
  });

  it('builds with file', async () => {
    const fileName = path.resolve(path.join(__dirname, './testfile.txt'));
    const { filePath, boundary, contentLength } = await buildMultipart([
      {
        name: 'foo',
        value: 'bar',
      },
      {
        name: 'file',
        type: 'file',
        fileName: fileName,
      },
      {
        name: 'baz',
        value: 'qux',
      },
    ]);
    expect(boundary).toBe(DEFAULT_BOUNDARY);
    expect(contentLength).toBe(322);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="foo"',
        '',
        'bar',
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="testfile.txt"',
        'Content-Type: text/plain',
        '',
        'Hello World!\n\nHow are you?',
        `--${boundary}`,
        'Content-Disposition: form-data; name="baz"',
        '',
        'qux',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );
  });

  it('skips entries with no name or value', async () => {
    const { filePath, boundary, contentLength } = await buildMultipart([
      {
        value: 'bar',
      },
      {
        name: 'foo',
      },
      {
        name: '',
        value: '',
      },
      {
        name: '',
        type: 'file',
        fileName: '',
      },
    ]);
    expect(boundary).toBe(DEFAULT_BOUNDARY);
    expect(contentLength).toBe(167);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name=""',
        '',
        'bar',
        `--${boundary}`,
        'Content-Disposition: form-data; name="foo"',
        '',
        '',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );
  });
});
