import {and,eq} from 'drizzle-orm';
import type {Db} from '../../db/client';
import {users,calendarConnections} from '../../db/schema';
import {NotFoundError} from './util';
export class CalendarInactiveError extends NotFoundError { constructor(){super('Active calendar account');} }
export async function assertCalendarActive(db:Db,userId:string,connectionId?:string) {
  const user=(await db.select({id:users.id}).from(users).where(and(eq(users.id,userId),eq(users.accountState,'active'))).limit(1))[0];
  if(!user)throw new CalendarInactiveError();
  if(connectionId){
    const connection=(await db.select({id:calendarConnections.id}).from(calendarConnections).where(and(eq(calendarConnections.id,connectionId),eq(calendarConnections.userId,userId),eq(calendarConnections.status,'active'))).limit(1))[0];
    if(!connection)throw new CalendarInactiveError();
  }
}
