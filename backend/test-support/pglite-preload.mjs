// Test-only preload. One isolated PostgreSQL engine per Node test worker; no server connections.
// bigint OID 20 is returned as text to match pg's default decoder. Multi-statement queries use the simple path.
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
process.env.NODE_ENV='test';process.env.TEST_DATABASE_URL='postgres://unused/natra_embedded_sweep_test';process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const db=new PGlite({extensions:{btree_gist}});
const {pool}=await import('../src/db/pool.js');
const normalize=r=>({...r,rows:r.rows?.map(row=>{const copy={...row};for(const f of r.fields??[])if(f.dataTypeID===20&&copy[f.name]!=null)copy[f.name]=String(copy[f.name]);return copy;}),rowCount:r.rowCount??(r.affectedRows||r.rows?.length||0)});
const query=async(sql,params)=>{
 if(params?.length)return normalize(await db.query(sql,params));
 const results=await db.exec(sql);return normalize(results.at(-1)??{rows:[],affectedRows:0});
};
pool.query=query;pool.connect=async()=>({query,release(){}});pool.end=()=>db.close();
