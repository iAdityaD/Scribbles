import { createGameServer } from './server.ts';
const server=createGameServer();
const port=Number(process.env.PORT??3001);
server.http.listen(port,process.env.HOST??'0.0.0.0',()=>console.log(`Scribbles listening on ${port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{await server.close();process.exit(0);});
