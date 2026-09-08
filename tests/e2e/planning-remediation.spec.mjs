import {test,expect} from './authenticated-fixture.mjs';

test('opt-in preview applies the displayed task and undo restores the session set',async({page,baseURL})=>{
  test.skip(process.env.STUDYUS_ISOLATED_AUDIT!=='1' || !['127.0.0.1','localhost'].includes(new URL(baseURL).hostname),'Disposable local database required');
  await page.goto('/planner',{waitUntil:'domcontentloaded'});
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
  const request = page.request;
  const original=(await (await request.get('/api/v1/planning/preferences')).json()).data;
  const created=await request.post('/api/v1/tasks',{data:{title:`Synthetic planning ${Date.now()}`,due_date:new Date(Date.now()+13*86400000).toISOString(),estimated_minutes:25,priority:2}});
  expect(created.status()).toBe(201);
  const task=(await created.json()).data;
  let applied;
  try {
    await page.goto('/planner',{waitUntil:'domcontentloaded'});
    await expect(page.locator('astro-island[component-url*="PlanningControls"]')).not.toHaveAttribute('ssr','');
    await page.locator('summary').filter({hasText:'Automatic planning'}).click();
    await expect(page.getByRole('button',{name:'Save planning settings',exact:true})).toBeEnabled();
    while(await page.getByRole('button',{name:/Remove availability/}).count()) await page.getByRole('button',{name:/Remove availability/}).first().click();
    await page.getByLabel('Time zone',{exact:true}).fill('UTC');
    await page.getByLabel('Weekly study capacity (minutes)',{exact:true}).fill('420');
    await page.getByLabel('Automatically adjust my study plan when things change',{exact:true}).check();
    await page.getByRole('button',{name:'Add study window',exact:true}).click();
    await page.getByLabel('Day for availability 1').selectOption('0');
    await page.getByLabel('From',{exact:true}).fill('08:00');
    await page.getByLabel('Until',{exact:true}).fill('20:00');
    await page.getByRole('button',{name:'Save planning settings',exact:true}).click();
    await expect(page.getByText('Automatic planning is on. Changes will appear below.',{exact:true})).toBeVisible();
    const previewResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/planning/preview') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Preview changes',exact:true}).click();
    const preview=(await (await previewResponse).json()).data;
    const change=preview.changes.find(change=>change.taskId===task.id);
    expect(change?.after?.plannedMinutes).toBe(25);
    await expect(page.getByRole('region',{name:'Planning preview'})).toContainText(task.title);
    const applyResponse=page.waitForResponse(r=>r.url().endsWith(`/planning/runs/${preview.id}/apply`));
    await page.getByRole('button',{name:'Apply these changes',exact:true}).click();
    expect((await applyResponse).ok()).toBe(true);
    applied=preview.id;
    const sessions=(await (await request.get('/api/v1/sessions')).json()).data;
    expect(sessions).toEqual(expect.arrayContaining([expect.objectContaining({id:change.sessionId,scheduled_at:new Date(change.after.scheduledAt).toISOString(),planned_minutes:25})]));
    const history=page.getByRole('region',{name:'Planning history'});
    await history.locator('summary').filter({hasText:'· applied'}).first().click();
    await history.getByRole('button',{name:'Undo these changes',exact:true}).click();
    await expect(page.getByText('Those planning changes were undone.',{exact:true})).toBeVisible();
    const restored=(await (await request.get('/api/v1/sessions')).json()).data;
    expect(restored.some(session=>session.id===change.sessionId)).toBe(false);
    applied=undefined;
  } finally {
    if(applied) await request.post(`/api/v1/planning/runs/${applied}/undo`,{data:{}});
    await request.delete(`/api/v1/tasks/${task.id}`,{data:{}});
    const current=(await (await request.get('/api/v1/planning/preferences')).json()).data;
    const {enabled,weeklyMinutes,availability,timezone}=original;
    const restored=await request.put('/api/v1/planning/preferences',{data:{enabled,weeklyMinutes,availability,timezone,expectedRevision:current.revision}});
    expect(restored.ok()).toBe(true);
  }
});
