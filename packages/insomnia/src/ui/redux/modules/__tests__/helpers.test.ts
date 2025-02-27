import { describe, expect, it, jest } from '@jest/globals';

import * as modals from '../../../components/modals';
import { askToImportIntoWorkspace, ForceToWorkspace } from '../helpers';

jest.mock('../../../components/modals');

describe('askToImportIntoWorkspace', () => {
  it('should return null if no active workspace', () => {
    const func = askToImportIntoWorkspace({ workspaceId: undefined, forceToWorkspace: ForceToWorkspace.new });
    expect(func()).toBeNull();
  });

  it('should return null if forcing to a new workspace', () => {
    const func = askToImportIntoWorkspace({ workspaceId: 'id', forceToWorkspace: ForceToWorkspace.new });
    expect(func()).toBeNull();
  });

  it('should return id if forcing to a current workspace', () => {
    const currentWorkspaceId = 'currentId';
    const func = askToImportIntoWorkspace({ workspaceId: currentWorkspaceId, forceToWorkspace: ForceToWorkspace.current });
    expect(func()).toBe(currentWorkspaceId);
  });

  it('should prompt the user if not forcing', () => {
    const currentWorkspaceId = 'current';
    const func = askToImportIntoWorkspace({ workspaceId: currentWorkspaceId });
    func();
    expect(modals.showModal).toHaveBeenCalledTimes(1);
  });
});
