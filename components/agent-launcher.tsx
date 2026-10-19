"use client";
import {usePathname} from 'next/navigation';
import {Bot} from 'lucide-react';
export default function AgentLauncher(){const path=usePathname();if(path?.startsWith('/agent'))return null;return <a href="/agent" aria-label="打开PLM智能Agent" style={{position:'fixed',right:24,bottom:80,zIndex:40,display:'flex',alignItems:'center',gap:8,padding:'12px 17px',borderRadius:28,background:'#6250a4',color:'white',fontSize:13,boxShadow:'0 6px 24px #154c3430',textDecoration:'none'}}><Bot size={19}/>PLM Agent</a>;}
