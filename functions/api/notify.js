export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 验证访问密钥
    const key = url.searchParams.get('key');
    const reminderId = url.searchParams.get('id');
    
    // 如果是测试请求（没有id参数），返回成功响应
    if (!reminderId) {
        return new Response(JSON.stringify({ 
            status: 'ok',
            message: 'Notification endpoint is working'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 验证密钥
    if (!key || key !== env.CRON_SECRET) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        // 获取提醒详情
        const { results } = await env.DB.prepare(
            'SELECT * FROM reminders WHERE id = ? AND status = 0'
        ).bind(reminderId).all();

        if (!results || results.length === 0) {
            return new Response('Reminder not found or already processed', { status: 404 });
        }

        const reminder = results[0];
        let notificationResults = [];

        // 发送到Telegram
        if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
            try {
                const displayTime = new Date(new Date(reminder.remind_time).getTime());
                const tgMessage = `🔔 提醒：${reminder.title}\n\n${reminder.content}\n\n⏰ 提醒时间：${displayTime.toLocaleString('zh-CN')}`;
                const tgResponse = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: env.TG_CHAT_ID,
                        text: tgMessage
                    })
                });

                const tgResult = await tgResponse.json();
                notificationResults.push({ platform: 'telegram', success: tgResponse.ok, result: tgResult });

                if (!tgResponse.ok) {
                    console.error('Telegram API error:', tgResult);
                }
            } catch (error) {
                console.error('Error sending Telegram message:', error);
                notificationResults.push({ platform: 'telegram', success: false, error: error.message });
            }
        }

        // 发送到企业微信
        if (env.WECOM_KEY) {
            try {
                const displayTime = new Date(new Date(reminder.remind_time).getTime());
                const wecomMessage = {
                    msgtype: 'text',
                    text: {
                        content: `🔔 提醒：${reminder.title}\n\n${reminder.content}\n\n⏰ 提醒时间：${displayTime.toLocaleString('zh-CN')}`
                    }
                };

                console.log('Sending WeCom message:', JSON.stringify(wecomMessage));
                console.log('WeCom webhook URL:', env.WECOM_KEY);

                const wecomResponse = await fetch(env.WECOM_KEY, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(wecomMessage)
                });

                const wecomResult = await wecomResponse.json();
                console.log('WeCom response:', wecomResult);
                notificationResults.push({ platform: 'wecom', success: wecomResponse.ok, result: wecomResult });

                if (!wecomResponse.ok) {
                    console.error('WeCom API error:', wecomResult);
                }
            } catch (error) {
                console.error('Error sending WeCom message:', error);
                notificationResults.push({ platform: 'wecom', success: false, error: error.message });
            }
        }

        // 更新提醒状态为已发送
        await env.DB.prepare(
            'UPDATE reminders SET status = 1 WHERE id = ?'
        ).bind(reminderId).run();

        // 删除定时任务
        if (reminder.cron_job_id && env.CRONJOB_API_KEY) {
            try {
                const deleteResponse = await fetch(`https://api.cron-job.org/jobs/${reminder.cron_job_id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${env.CRONJOB_API_KEY}`
                    }
                });

                if (!deleteResponse.ok) {
                    console.error('Failed to delete cron job:', await deleteResponse.text());
                }
            } catch (error) {
                console.error('Error deleting cron job:', error);
            }
        }

        return new Response(JSON.stringify({
            success: true,
            notifications: notificationResults
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Notification error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            notifications: notificationResults
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
} 