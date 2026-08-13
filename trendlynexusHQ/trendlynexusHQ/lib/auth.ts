import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import type { NextAuthOptions } from "next-auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
export const authOptions: NextAuthOptions = { adapter:PrismaAdapter(prisma), session:{strategy:"database"}, providers:[EmailProvider({server:{host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}},from:process.env.EMAIL_FROM}),CredentialsProvider({name:"Credentials",credentials:{email:{type:"email"},password:{type:"password"}},async authorize(c){if(!c?.email||!c.password)return null;const u=await prisma.user.findUnique({where:{email:c.email.toLowerCase()}});if(!u?.passwordHash||!(await bcrypt.compare(c.password,u.passwordHash)))return null;return {id:u.id,email:u.email,name:u.name};}})],callbacks:{async session({session,user}){if(session.user)session.user.id=user.id;return session;}},pages:{signIn:"/login"},secret:process.env.NEXTAUTH_SECRET};
