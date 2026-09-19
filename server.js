import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-1207987773430651-091300-6f03f6c2011ba35013c01e3a052ace6e-1885251906';
const MERCADO_PAGO_PUBLIC_KEY = process.env.MERCADO_PAGO_PUBLIC_KEY || 'APP_USR-2dc3e363-b4c1-43ca-a796-6466d7b3caf0';

// Configuração opcional do Firebase Admin SDK caso as credenciais estejam disponíveis
let db = null;
let adminAuth = null;
try {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const { default: admin } = await import('firebase-admin');
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        db = admin.firestore();
        adminAuth = admin.auth();
        console.log('✅ Firebase Admin SDK conectado com sucesso ao projeto:', serviceAccount.project_id);
    }
} catch (err) {
    console.warn('⚠️ Firebase Admin SDK não inicializado:', err.message);
}

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Private-Network', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Idempotency-Key');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Função utilitária para ativar VIP de 30 dias para um usuário no Firestore
 */
async function activateUserVipInFirestore(uid, paymentId, paymentType = 'pix') {
    if (!uid) return;
    const now = Date.now();
    const vipExpiresAt = now + (30 * 24 * 60 * 60 * 1000); // 30 dias a partir da confirmação

    if (db) {
        try {
            await db.collection('users').doc(uid).set({
                isVip: true,
                isVerified: true,
                vipStatus: 'active',
                vipExpiresAt: vipExpiresAt,
                vipLastPaymentId: String(paymentId),
                vipLastPaymentDate: now,
                vipPaymentType: paymentType,
                vipRequestStatus: 'approved'
            }, { merge: true });

            await db.collection('vip_payments').doc(String(paymentId)).set({
                uid,
                paymentId: String(paymentId),
                amount: 30.00,
                status: 'approved',
                paymentType,
                approvedAt: now,
                vipExpiresAt: vipExpiresAt
            }, { merge: true });

            await db.collection('notifications').add({
                toUid: uid,
                type: 'vip',
                title: 'Selo VIP Ativado! ⭐',
                message: 'Seu pagamento de R$ 30,00 foi aprovado! Seu Selo de Verificado VIP foi ativado com sucesso pelos próximos 30 dias.',
                read: false,
                createdAt: now,
                author: 'VORTEX VIP'
            }).catch(() => {});

            console.log(`[VIP] Ativado com sucesso para UID ${uid} até ${new Date(vipExpiresAt).toISOString()}`);
        } catch (e) {
            console.error('[VIP] Erro ao salvar ativação no Firestore:', e);
        }
    }
}

// 1. Configuração pública para o cliente (somente Public Key)
app.get('/api/config', (req, res) => {
    res.json({
        publicKey: MERCADO_PAGO_PUBLIC_KEY,
        amount: 30.00,
        currency: 'BRL',
        plan: 'Assinatura Mensal Selo VIP - VORTEX VIP'
    });
});

// 2. Criação de Pagamento PIX (R$ 30,00)
app.post('/api/create-pix-payment', async (req, res) => {
    try {
        const { uid, email, name, cpf } = req.body || {};
        if (!uid) {
            return res.status(400).json({ error: 'UID do usuário é obrigatório.' });
        }

        const payerEmail = (email && email.includes('@')) ? email.trim() : 'cliente@vortex.vip';
        const cleanCpf = (cpf || '11144477735').replace(/\D/g, '').padEnd(11, '0').slice(0, 11);
        const nameParts = (name || 'Cliente VORTEX').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Cliente';
        const lastName = nameParts.slice(1).join(' ') || 'VIP';

        const host = req.get('host') || '';
        const isPublicDomain = host && !host.includes('localhost') && !host.includes('127.0.0.1');

        const paymentPayload = {
            transaction_amount: 30.00,
            description: 'Assinatura Mensal Selo VIP - VORTEX',
            payment_method_id: 'pix',
            payer: {
                email: payerEmail,
                first_name: firstName,
                last_name: lastName,
                identification: {
                    type: 'CPF',
                    number: cleanCpf
                }
            },
            ...(isPublicDomain ? { notification_url: `${req.protocol}://${host}/api/mercadopago-webhook` } : {}),
            metadata: {
                uid: uid,
                plan: 'vip_monthly',
                amount: 30.00
            }
        };

        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `${uid}_pix_${Date.now()}`
            },
            body: JSON.stringify(paymentPayload)
        });

        const mpData = await mpRes.json();

        if (!mpRes.ok) {
            console.error('Erro Mercado Pago PIX:', mpData);
            return res.status(mpRes.status).json({
                error: mpData.message || 'Erro ao gerar Pix no Mercado Pago.',
                details: mpData
            });
        }

        const pointOfInteraction = mpData.point_of_interaction || {};
        const transactionData = pointOfInteraction.transaction_data || {};

        if (db && mpData.id) {
            db.collection('vip_payments').doc(String(mpData.id)).set({
                uid,
                paymentId: String(mpData.id),
                type: 'pix',
                amount: 30.00,
                status: mpData.status || 'pending',
                createdAt: Date.now()
            }, { merge: true }).catch(() => {});
        }

        res.json({
            id: mpData.id,
            status: mpData.status,
            qr_code: transactionData.qr_code || '',
            qr_code_base64: transactionData.qr_code_base64 || '',
            ticket_url: transactionData.ticket_url || '',
            amount: 30.00
        });
    } catch (err) {
        console.error('Erro ao processar criação de Pix:', err);
        res.status(500).json({ error: 'Erro interno ao gerar pagamento Pix.' });
    }
});

// 3. Criação de Pagamento via Cartão de Crédito ou Débito (R$ 30,00)
app.post('/api/create-card-payment', async (req, res) => {
    try {
        const {
            token,
            paymentMethodId,
            issuerId,
            installments = 1,
            payer,
            uid,
            isDebit = false
        } = req.body || {};

        if (!uid || !token) {
            return res.status(400).json({ error: 'Token do cartão e UID são obrigatórios.' });
        }

        const paymentPayload = {
            transaction_amount: 30.00,
            token: token,
            description: isDebit ? 'Assinatura Selo VIP (Débito) - VORTEX' : 'Assinatura Mensal Selo VIP (Crédito) - VORTEX',
            installments: Number(installments) || 1,
            payment_method_id: paymentMethodId || (isDebit ? 'debelo' : 'master'),
            issuer_id: issuerId ? String(issuerId) : undefined,
            payer: {
                email: payer?.email || 'cliente@vortex.vip',
                identification: {
                    type: payer?.identification?.type || 'CPF',
                    number: (payer?.identification?.number || '11144477735').replace(/\D/g, '')
                }
            },
            metadata: {
                uid: uid,
                plan: 'vip_monthly',
                isDebit: Boolean(isDebit)
            }
        };

        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `${uid}_card_${Date.now()}`
            },
            body: JSON.stringify(paymentPayload)
        });

        const mpData = await mpRes.json();

        if (!mpRes.ok) {
            console.error('Erro Mercado Pago Cartão:', mpData);
            return res.status(mpRes.status).json({
                error: mpData.message || 'Erro ao processar cartão.',
                details: mpData
            });
        }

        if (mpData.status === 'approved') {
            await activateUserVipInFirestore(uid, mpData.id, isDebit ? 'card_debit' : 'card_credit');
        }

        res.json({
            id: mpData.id,
            status: mpData.status,
            status_detail: mpData.status_detail,
            isApproved: mpData.status === 'approved',
            amount: 30.00
        });
    } catch (err) {
        console.error('Erro ao processar pagamento com cartão:', err);
        res.status(500).json({ error: 'Erro interno ao processar pagamento com cartão.' });
    }
});

// 4. Checagem de Status do Pagamento (Polling para Pix e Cartão)
app.get('/api/payment-status/:id', async (req, res) => {
    const paymentId = req.params.id;
    if (!paymentId) return res.status(400).json({ error: 'ID do pagamento não informado.' });

    try {
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
            }
        });

        const mpData = await mpRes.json();
        if (!mpRes.ok) {
            return res.status(mpRes.status).json(mpData);
        }

        const isApproved = mpData.status === 'approved';
        const uid = mpData.metadata?.uid;

        if (isApproved && uid) {
            await activateUserVipInFirestore(uid, paymentId, mpData.payment_method_id || 'pix');
        }

        res.json({
            id: mpData.id,
            status: mpData.status,
            status_detail: mpData.status_detail,
            isApproved: isApproved,
            uid: uid || null
        });
    } catch (err) {
        console.error('Erro ao verificar status do pagamento:', err);
        res.status(500).json({ error: 'Erro ao consultar pagamento.' });
    }
});

// 5. Webhook do Mercado Pago (Notificação Instantânea IPN)
app.post('/api/mercadopago-webhook', async (req, res) => {
    res.status(200).send('OK');

    try {
        const query = req.query || {};
        const body = req.body || {};
        const paymentId = query['data.id'] || body?.data?.id || query.id || body.id;
        const topic = query.type || body.type || query.topic || body.action;

        if ((topic === 'payment' || String(topic).includes('payment')) && paymentId) {
            const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
                }
            });

            if (mpRes.ok) {
                const mpData = await mpRes.json();
                if (mpData.status === 'approved') {
                    const uid = mpData.metadata?.uid;
                    if (uid) {
                        await activateUserVipInFirestore(uid, paymentId, mpData.payment_method_id || 'pix');
                    }
                }
            }
        }
// 6. Exclusão Total de Conta de Usuário (Admin ou Próprio Usuário no VORTEX VIP)
app.post('/api/delete-user-account', async (req, res) => {
    try {
        const { targetUid, requesterUid, requesterEmail, deletedBy } = req.body || {};
        if (!targetUid) {
            return res.status(400).json({ error: 'UID do usuário a ser excluído é obrigatório.' });
        }

        const adminEmails = [
            'dxhub.oficial@gmail.com',
            'vortex.dx.oficial@gmail.com',
            'dxhubdigitalsuporte@gmail.com'
        ];

        const reqEmail = (requesterEmail || '').toLowerCase().trim();
        const isRequesterAdmin = adminEmails.includes(reqEmail);
        const isSelf = requesterUid && (requesterUid === targetUid);

        if (!isRequesterAdmin && !isSelf) {
            return res.status(403).json({ error: 'Acesso negado. Apenas o próprio usuário ou administradores podem apagar a conta.' });
        }

        console.log(`[DELETE-ACCOUNT] Iniciando exclusão completa da conta ${targetUid} solicitada por ${requesterEmail || requesterUid} (tipo: ${deletedBy || (isSelf ? 'self' : 'admin')})`);

        // 1. Deletar do Firebase Authentication (se Admin SDK disponível)
        if (adminAuth) {
            try {
                await adminAuth.deleteUser(targetUid);
                console.log(`[DELETE-ACCOUNT] Usuário ${targetUid} removido do Firebase Auth.`);
            } catch (authErr) {
                console.warn(`[DELETE-ACCOUNT] Aviso Firebase Auth deleteUser:`, authErr.message);
            }
        }

        // 2. Limpeza física no Firestore (se Firestore Admin SDK disponível)
        if (db) {
            try {
                const batch = db.batch();

                // Gravar tombstone definitivo em deleted_users para bloquear imediatamente em tempo real
                const deletedUserRef = db.collection('deleted_users').doc(targetUid);
                batch.set(deletedUserRef, {
                    uid: targetUid,
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedBy: deletedBy || (isSelf ? 'self' : 'admin'),
                    requesterEmail: reqEmail || null
                }, { merge: true });

                // Deletar o documento do usuário
                const userRef = db.collection('users').doc(targetUid);
                batch.delete(userRef);

                await batch.commit().catch(e => console.warn('[DELETE-ACCOUNT] Erro no batch inicial:', e.message));

                // Excluir postagens do feed deste autor
                const postsSnap = await db.collection('posts').where('authorUid', '==', targetUid).get().catch(() => null);
                if (postsSnap && !postsSnap.empty) {
                    const pBatch = db.batch();
                    postsSnap.docs.forEach(d => pBatch.delete(d.ref));
                    await pBatch.commit().catch(() => {});
                }

                // Excluir stories do autor
                const storiesSnap = await db.collection('stories').where('authorUid', '==', targetUid).get().catch(() => null);
                if (storiesSnap && !storiesSnap.empty) {
                    const sBatch = db.batch();
                    storiesSnap.docs.forEach(d => sBatch.delete(d.ref));
                    await sBatch.commit().catch(() => {});
                }

                // Excluir grupos onde ele é criador
                const groupsSnap = await db.collection('groups').where('creatorUid', '==', targetUid).get().catch(() => null);
                if (groupsSnap && !groupsSnap.empty) {
                    const gBatch = db.batch();
                    groupsSnap.docs.forEach(d => gBatch.delete(d.ref));
                    await gBatch.commit().catch(() => {});
                }

                // Excluir solicitações de amizade
                const reqFromSnap = await db.collection('requests').where('fromUid', '==', targetUid).get().catch(() => null);
                if (reqFromSnap && !reqFromSnap.empty) {
                    const rBatch = db.batch();
                    reqFromSnap.docs.forEach(d => rBatch.delete(d.ref));
                    await rBatch.commit().catch(() => {});
                }
                const reqToSnap = await db.collection('requests').where('toUid', '==', targetUid).get().catch(() => null);
                if (reqToSnap && !reqToSnap.empty) {
                    const rBatch = db.batch();
                    reqToSnap.docs.forEach(d => rBatch.delete(d.ref));
                    await rBatch.commit().catch(() => {});
                }

                // Excluir notificações
                const notifsToSnap = await db.collection('notifications').where('toUid', '==', targetUid).get().catch(() => null);
                if (notifsToSnap && !notifsToSnap.empty) {
                    const nBatch = db.batch();
                    notifsToSnap.docs.forEach(d => nBatch.delete(d.ref));
                    await nBatch.commit().catch(() => {});
                }

                // Excluir reserva de usernames
                const uNamesSnap = await db.collection('usernames').where('uid', '==', targetUid).get().catch(() => null);
                if (uNamesSnap && !uNamesSnap.empty) {
                    const unBatch = db.batch();
                    uNamesSnap.docs.forEach(d => unBatch.delete(d.ref));
                    await unBatch.commit().catch(() => {});
                }
            } catch (dbErr) {
                console.error('[DELETE-ACCOUNT] Erro ao limpar coleções no Firestore:', dbErr);
            }
        }

        res.json({
            success: true,
            message: `Conta ${targetUid} apagada com sucesso para todos no VORTEX VIP ⚡.`
        });
    } catch (err) {
        console.error('Erro na rota /api/delete-user-account:', err);
        res.status(500).json({ error: 'Erro interno ao apagar conta do usuário.' });
    }
});

// Fallback SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Exporta app para Cloud Functions ou inicia servidor se executado diretamente
export default app;

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`⚡ VORTEX VIP Server rodando na porta ${PORT}: http://localhost:${PORT}`);
    });
}
