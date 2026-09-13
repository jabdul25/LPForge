import {Client} from 'pg';

const url=process.env.DATABASE_URL;
if(!url)throw new Error('DATABASE_URL required');
const planId=`funded-continuation-concurrency-${process.pid}`;
const key=`lpforge:funded-open-continuation:${planId}`;
const first=new Client({connectionString:url}),second=new Client({connectionString:url});
await Promise.all([first.connect(),second.connect()]);
try{
  const [a,b]=await Promise.all([
    first.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[key]),
    second.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[key]),
  ]);
  const acquired=[a.rows[0]?.acquired===true,b.rows[0]?.acquired===true];
  if(acquired.filter(Boolean).length!==1)throw new Error(`LPFORGE_FUNDED_CONTINUATION_CONCURRENCY_EXPECTED_ONE_WINNER:${acquired.join(',')}`);
  const winner=acquired[0]?first:second,loser=acquired[0]?second:first;
  await winner.query('SELECT pg_advisory_unlock(hashtext($1))',[key]);
  const retry=await loser.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',[key]);
  if(retry.rows[0]?.acquired!==true)throw new Error('LPFORGE_FUNDED_CONTINUATION_CONCURRENCY_RELEASE_FAILED');
  await loser.query('SELECT pg_advisory_unlock(hashtext($1))',[key]);
}finally{await Promise.allSettled([first.end(),second.end()]);}
console.log('FUNDED_OPEN_CONTINUATION_POSTGRES_CONCURRENCY_OK exactly_one_worker_claimed_same_plan=PASS');
