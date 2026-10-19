import type { Metadata } from 'next';
export const metadata:Metadata={title:'MedFlow PLM · 独立应用',description:'独立PLM业务系统，独立数据存储与消息协作。',icons:{icon:'/favicon.svg'}};
import AgentLauncher from '@/components/agent-launcher';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}<AgentLauncher/></body></html>}
