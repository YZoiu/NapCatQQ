import { describe, expect, it } from 'vitest';
import { NativePacketHandler } from '@/napcat-core/packet/handler/client';

function createLogger() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(' '));
  };
  return {
    lines,
    logger: {
      log: push,
      logWarn: push,
      logError: push,
    },
  };
}

function handlerWith(initHook: () => boolean | string) {
  const created = createLogger();
  const handler = new NativePacketHandler({ logger: created.logger as never });
  const internal = handler as unknown as {
    loaded: boolean;
    receiveInitError: string;
    MoeHooExport: { exports: { initHook?: () => boolean | string } };
  };
  internal.loaded = true;
  internal.MoeHooExport.exports.initHook = initHook;
  return { handler, lines: created.lines, internal };
}

describe('PacketHandler.init receive hook', () => {
  it('is not a successful init when initHook returns false', async () => {
    const { handler, lines, internal } = handlerWith(() => false);
    await expect(handler.init('9.9.32-50969', false)).resolves.toBe(false);
    expect(lines.join('\n')).not.toContain('初始化成功');
    expect(internal.receiveInitError).toContain('rejected');
  });

  it('logs success only after initHook accepts the callback', async () => {
    const { handler, lines, internal } = handlerWith(() => true);
    await expect(handler.init('9.9.32-50969', false)).resolves.toBe(true);
    expect(lines.join('\n')).toContain('[PacketHandler] 初始化成功');
    expect(internal.receiveInitError).toBe('');
  });

  // MoeHoo.win32.x64.node reports its result as a status string, so `=== true`
  // used to reject a hook that had actually been installed and was delivering
  // packets. Every Windows run then reported "initHook rejected the receive
  // hook" and XHB refused to attach the account.
  it('accepts the native "success" status string', async () => {
    const { handler, lines, internal } = handlerWith(() => 'success');
    await expect(handler.init('9.9.32-50969', true)).resolves.toBe(true);
    expect(lines.join('\n')).toContain('[PacketHandler] 初始化成功');
    expect(lines.join('\n')).not.toContain('收包钩子未初始化');
    expect(internal.receiveInitError).toBe('');
  });

  it('surfaces the native status when the hook really fails', async () => {
    const { handler, lines, internal } = handlerWith(() => 'error prepare recv');
    await expect(handler.init('9.9.32-50969', true)).resolves.toBe(false);
    expect(lines.join('\n')).not.toContain('初始化成功');
    expect(internal.receiveInitError).toContain('error prepare recv');
  });
});