import { createChatService } from '../../chat/chat-service';
import { createRerankService } from '../../common/rerank-service';
import { createSyncService } from '../../sync/sync-service';
import { createChatController } from '../controllers/chat-controller';
import { createHelpController } from '../controllers/help-controller';
import { createSyncController } from '../controllers/sync-controller';

import { createCommandRouter } from './command-router';

/**
 * コマンドルーターを構築し、すべてのコマンドを登録する
 */
export function buildRouter() {
  const router = createCommandRouter();
  const syncService = createSyncService();
  const chatService = createChatService(createRerankService());

  router.register('sync', createSyncController(syncService));
  router.register('chat', createChatController(chatService));
  router.register('help', createHelpController());

  return router;
}
