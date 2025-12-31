import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalService, getTerminalService } from '@/services/terminal-service.js';
import * as pty from 'node-pty';
import * as os from 'os';
import * as fs from 'fs';

vi.mock('node-pty');
vi.mock('fs');
vi.mock('os');

describe('terminal-service.ts', () => {
  let service: TerminalService;
  let mockPtyProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TerminalService();

    // Mock PTY process
    mockPtyProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };

    vi.mocked(pty.spawn).mockReturnValue(mockPtyProcess);
    vi.mocked(os.homedir).mockReturnValue('/home/user');
    vi.mocked(os.platform).mockReturnValue('linux');
    vi.mocked(os.arch).mockReturnValue('x64');
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('detectShell', () => {
    it('should detect PowerShell Core on Windows when available', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        return path === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
      expect(result.args).toEqual([]);
    });

    it('should fall back to PowerShell on Windows if Core not available', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        return path === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      expect(result.args).toEqual([]);
    });

    it('should fall back to cmd.exe on Windows if no PowerShell', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = service.detectShell();

      expect(result.shell).toBe('cmd.exe');
      expect(result.args).toEqual([]);
    });

    it('should detect user shell on macOS', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/zsh' });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/zsh');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to zsh on macOS if user shell not available', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        return path === '/bin/zsh';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/zsh');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to bash on macOS if zsh not available', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });

    it('should detect user shell on Linux', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to bash on Linux if user shell not available', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        return path === '/bin/bash';
      });

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });

    it('should fall back to sh on Linux if bash not available', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({});
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/sh');
      expect(result.args).toEqual([]);
    });

    it('should detect WSL and use appropriate shell', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('Linux version 5.10.0-microsoft-standard-WSL2');

      const result = service.detectShell();

      expect(result.shell).toBe('/bin/bash');
      expect(result.args).toEqual(['--login']);
    });
  });

  describe('isWSL', () => {
    it('should return true if /proc/version contains microsoft', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('Linux version 5.10.0-microsoft-standard-WSL2');

      expect(service.isWSL()).toBe(true);
    });

    it('should return true if /proc/version contains wsl', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('Linux version 5.10.0-wsl2');

      expect(service.isWSL()).toBe(true);
    });

    it('should return true if WSL_DISTRO_NAME is set', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ WSL_DISTRO_NAME: 'Ubuntu' });

      expect(service.isWSL()).toBe(true);
    });

    it('should return true if WSLENV is set', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ WSLENV: 'PATH/l' });

      expect(service.isWSL()).toBe(true);
    });

    it('should return false if not in WSL', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.spyOn(process, 'env', 'get').mockReturnValue({});

      expect(service.isWSL()).toBe(false);
    });

    it('should return false if error reading /proc/version', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(service.isWSL()).toBe(false);
    });
  });

  describe('getPlatformInfo', () => {
    it('should return platform information', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(os.arch).mockReturnValue('x64');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const info = service.getPlatformInfo();

      expect(info.platform).toBe('linux');
      expect(info.arch).toBe('x64');
      expect(info.defaultShell).toBe('/bin/bash');
      expect(typeof info.isWSL).toBe('boolean');
    });
  });

  describe('createSession', () => {
    // Skip on Windows as path.resolve converts Unix paths to Windows paths (CI runs on Linux)
    it.skipIf(process.platform === 'win32')('should create a new terminal session', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession({
        cwd: '/test/dir',
        cols: 100,
        rows: 30,
      });

      expect(session.id).toMatch(/^term-/);
      expect(session.cwd).toBe('/test/dir');
      expect(session.shell).toBe('/bin/bash');
      expect(pty.spawn).toHaveBeenCalledWith(
        '/bin/bash',
        ['--login'],
        expect.objectContaining({
          cwd: '/test/dir',
          cols: 100,
          rows: 30,
        })
      );
    });

    it('should use default cols and rows if not provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      service.createSession();

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          cols: 80,
          rows: 24,
        })
      );
    });

    it('should fall back to home directory if cwd does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession({
        cwd: '/nonexistent',
      });

      expect(session.cwd).toBe('/home/user');
    });

    it('should fall back to home directory if cwd is not a directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession({
        cwd: '/file.txt',
      });

      expect(session.cwd).toBe('/home/user');
    });

    // Skip on Windows as path.resolve converts Unix paths to Windows paths (CI runs on Linux)
    it.skipIf(process.platform === 'win32')('should fix double slashes in path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession({
        cwd: '//test/dir',
      });

      expect(session.cwd).toBe('/test/dir');
    });

    it('should preserve WSL UNC paths', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession({
        cwd: '//wsl$/Ubuntu/home',
      });

      expect(session.cwd).toBe('//wsl$/Ubuntu/home');
    });

    it('should handle data events from PTY', () => {
      vi.useFakeTimers();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const dataCallback = vi.fn();
      service.onData(dataCallback);

      service.createSession();

      // Simulate data event
      const onDataHandler = mockPtyProcess.onData.mock.calls[0][0];
      onDataHandler('test data');

      // Wait for throttled output
      vi.advanceTimersByTime(20);

      expect(dataCallback).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle exit events from PTY', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const exitCallback = vi.fn();
      service.onExit(exitCallback);

      const session = service.createSession();

      // Simulate exit event
      const onExitHandler = mockPtyProcess.onExit.mock.calls[0][0];
      onExitHandler({ exitCode: 0 });

      expect(exitCallback).toHaveBeenCalledWith(session.id, 0);
      expect(service.getSession(session.id)).toBeUndefined();
    });
  });

  describe('write', () => {
    it('should write data to existing session', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession();
      const result = service.write(session.id, 'ls\n');

      expect(result).toBe(true);
      expect(mockPtyProcess.write).toHaveBeenCalledWith('ls\n');
    });

    it('should return false for non-existent session', () => {
      const result = service.write('nonexistent', 'data');

      expect(result).toBe(false);
      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('should resize existing session', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession();
      const result = service.resize(session.id, 120, 40);

      expect(result).toBe(true);
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
    });

    it('should return false for non-existent session', () => {
      const result = service.resize('nonexistent', 120, 40);

      expect(result).toBe(false);
      expect(mockPtyProcess.resize).not.toHaveBeenCalled();
    });

    it('should handle resize errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      mockPtyProcess.resize.mockImplementation(() => {
        throw new Error('Resize failed');
      });

      const session = service.createSession();
      const result = service.resize(session.id, 120, 40);

      expect(result).toBe(false);
    });
  });

  describe('killSession', () => {
    it('should kill existing session', () => {
      vi.useFakeTimers();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession();
      const result = service.killSession(session.id);

      expect(result).toBe(true);
      expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Session is removed after SIGKILL timeout (1 second)
      vi.advanceTimersByTime(1000);

      expect(mockPtyProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(service.getSession(session.id)).toBeUndefined();

      vi.useRealTimers();
    });

    it('should return false for non-existent session', () => {
      const result = service.killSession('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle kill errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      mockPtyProcess.kill.mockImplementation(() => {
        throw new Error('Kill failed');
      });

      const session = service.createSession();
      const result = service.killSession(session.id);

      expect(result).toBe(false);
    });
  });

  describe('getSession', () => {
    it('should return existing session', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession();
      const retrieved = service.getSession(session.id);

      expect(retrieved).toBe(session);
    });

    it('should return undefined for non-existent session', () => {
      const retrieved = service.getSession('nonexistent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getScrollback', () => {
    it('should return scrollback buffer for existing session', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session = service.createSession();
      session.scrollbackBuffer = 'test scrollback';

      const scrollback = service.getScrollback(session.id);

      expect(scrollback).toBe('test scrollback');
    });

    it('should return null for non-existent session', () => {
      const scrollback = service.getScrollback('nonexistent');

      expect(scrollback).toBeNull();
    });
  });

  describe('getAllSessions', () => {
    // Skip on Windows as path.resolve converts Unix paths to Windows paths (CI runs on Linux)
    it.skipIf(process.platform === 'win32')('should return all active sessions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session1 = service.createSession({ cwd: '/dir1' });
      const session2 = service.createSession({ cwd: '/dir2' });

      const sessions = service.getAllSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(session1.id);
      expect(sessions[1].id).toBe(session2.id);
      expect(sessions[0].cwd).toBe('/dir1');
      expect(sessions[1].cwd).toBe('/dir2');
    });

    it('should return empty array if no sessions', () => {
      const sessions = service.getAllSessions();

      expect(sessions).toEqual([]);
    });
  });

  describe('onData and onExit', () => {
    it('should allow subscribing and unsubscribing from data events', () => {
      const callback = vi.fn();
      const unsubscribe = service.onData(callback);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should allow subscribing and unsubscribing from exit events', () => {
      const callback = vi.fn();
      const unsubscribe = service.onExit(callback);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });
  });

  describe('cleanup', () => {
    it('should clean up all sessions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });

      const session1 = service.createSession();
      const session2 = service.createSession();

      service.cleanup();

      expect(service.getSession(session1.id)).toBeUndefined();
      expect(service.getSession(session2.id)).toBeUndefined();
      expect(service.getAllSessions()).toHaveLength(0);
    });

    it('should handle cleanup errors gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.spyOn(process, 'env', 'get').mockReturnValue({ SHELL: '/bin/bash' });
      mockPtyProcess.kill.mockImplementation(() => {
        throw new Error('Kill failed');
      });

      service.createSession();

      expect(() => service.cleanup()).not.toThrow();
    });
  });

  describe('getTerminalService', () => {
    it('should return singleton instance', () => {
      const instance1 = getTerminalService();
      const instance2 = getTerminalService();

      expect(instance1).toBe(instance2);
    });
  });
});
