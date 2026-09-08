import {test,expect} from '@playwright/test';

test('built Clerk sign-in retains the local signup and reviewed return path',async({page,baseURL})=>{
  const violations=[];
  page.on('console',message=>{
    if(message.type()==='error' && /Content Security Policy|violates.*directive/i.test(message.text())) violations.push(message.text());
  });
  await page.goto('/sign-in?from=demo&return=%2Fplanner',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('textbox',{name:'Email address',exact:true})).toBeVisible();
  const signup=page.getByRole('link',{name:'Sign up',exact:true});
  await expect(signup).toBeVisible();
  const destination=new URL(await signup.getAttribute('href'),baseURL);
  expect(destination.origin).toBe(new URL(baseURL).origin);
  expect(destination.pathname).toBe('/sign-up');
  expect(destination.searchParams.get('return')).toBe('/planner');
  expect(destination.searchParams.get('from')).toBe('demo');
  expect(violations).toEqual([]);
});
