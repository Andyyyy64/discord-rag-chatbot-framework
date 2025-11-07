import { Logger } from 'tslog';

// tslogのログレベル定義: 0: silly, 1: trace, 2: debug, 3: info, 4: warn, 5: error, 6: fatal
export const logger = new Logger({
  name: 'discord-rag-framework',
  minLevel: process.env.NODE_ENV === 'production' ? 3 : 2,
});
